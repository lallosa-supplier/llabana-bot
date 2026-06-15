require('dotenv').config();

// Validar variables de entorno requeridas
const REQUIRED_ENV = [
  'ANTHROPIC_API_KEY',
  'GOOGLE_SHEETS_ID',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'WIG_WHATSAPP_NUMBER',
];
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const webhookHandler = require('./webhookHandler');
const shopifyWebhookHandler = require('./shopifyWebhookHandler');
const { getTranscripts } = require('./transcriptService');
const { invalidateCache } = require('./knowledgeService');
const { runFollowUps }   = require('./followUpService');
const colaEscalaciones   = require('./colaEscalaciones');
const { getRedisClient } = require('./sessionManager');
const costTracker        = require('./costTracker');
const costSync           = require('./costSync');

const app = express();
// Railway corre detrás de un proxy: confiar en X-Forwarded-For (necesario para rate-limit)
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Rate limiters para webhooks
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 1000, // máximo 1000 requests por ventana
  message: 'Demasiadas solicitudes al webhook, intenta de nuevo más tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Shopify webhook — DEBE ir antes del bodyParser global ────────────────────
// Shopify requiere el raw body (Buffer) para verificar la firma HMAC.
// Al definir esta ruta antes de app.use(bodyParser.json()), Express aplica
// express.raw() a esta ruta antes de que el parser global intervenga.
app.post(
  '/webhook/shopify',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  shopifyWebhookHandler
);

// ── Parsers globales para el resto de rutas ──────────────────────────────────
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ── Rutas ────────────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const checks = {
    status: 'ok',
    service: 'llabana-bot',
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || 'local').substring(0, 7),
    timestamp: new Date().toISOString(),
    redis: 'unknown',
    uptime: Math.floor(process.uptime()) + 's',
  };

  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.ping();
      checks.redis = 'ok';
    } else {
      checks.redis = 'fallback_memory';
    }
  } catch (err) {
    checks.redis = 'error';
    checks.status = 'degraded';
  }

  const httpStatus = checks.status === 'ok' || checks.status === 'degraded' ? 200 : 503;
  res.status(httpStatus).json(checks);
});

app.post('/webhook/whatsapp', webhookLimiter, webhookHandler);

app.use('/dashboard', express.static(path.join(__dirname, '../public')));

app.get('/api/transcripts', async (req, res) => {
  try {
    const data = await getTranscripts();
    res.json(data);
  } catch (err) {
    console.error('[API] Error transcripts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Token simple para proteger los endpoints de costos. Se acepta por header
// x-dashboard-token o por query ?token=. Si DASHBOARD_TOKEN no está configurada,
// NO se exige (para no romper el dashboard antes de definirla).
function requireDashboardToken(req, res, next) {
  const expected = process.env.DASHBOARD_TOKEN;
  if (!expected) return next();
  const got = req.get('x-dashboard-token') || req.query.token;
  if (got === expected) return next();
  return res.status(401).json({ error: 'no autorizado' });
}

app.get('/api/costs', requireDashboardToken, async (req, res) => {
  try {
    const data = await costTracker.getCosts();
    res.json(data);
  } catch (err) {
    console.error('[API] Error costs:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/costs/sync', requireDashboardToken, async (req, res) => {
  try {
    const m = parseInt(req.query.months, 10);
    const months = Number.isFinite(m) && m >= 0 ? m : undefined;
    const summary = await costSync.syncAll(months);
    res.json({ ok: true, months: summary });
  } catch (err) {
    console.error('[API] Error costs/sync:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const WA_LINKS = {
  'web-footer':      'Hola, quiero mas informacion',
  'web-header':      'Hola, me podrian dar mas informacion',
  'web-chat':        'Hola, quiero mas informes',
  'web-producto':    'Hola, vi un producto que me interesa',
  'tienda-producto': 'Hola, vi un producto en su tienda en linea',
  'tienda-chat':     'Hola, me mandaron aqui desde la tienda',
  'facebook':        'Hola, los vi en Facebook',
};

app.get('/wa/:origen', (req, res) => {
  const origen = req.params.origen.toLowerCase();
  const texto  = WA_LINKS[origen];
  if (!texto) {
    return res.status(404).json({ error: 'Link no encontrado' });
  }
  const encoded = encodeURIComponent(texto);
  const url = `https://wa.me/17623490579?text=${encoded}`;
  res.redirect(302, url);
});

app.post('/admin/refresh-kb', (req, res) => {
  invalidateCache();
  res.json({ ok: true, message: 'Cache invalidado' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.listen(PORT, () => {
  console.log(`🐾 LlabanaBot corriendo en puerto ${PORT}`);
  console.log(`📱 WhatsApp: POST /webhook/whatsapp`);
  console.log(`🛍️  Shopify:  POST /webhook/shopify`);

  // Pasar cliente Redis a la cola de escalaciones
  colaEscalaciones.setRedis(getRedisClient());
  console.log('📥 Cola de escalaciones fuera de horario activa');

  // Sincroniza costos REALES (Twilio + Anthropic) a "8 Costos": ~30s tras boot y cada 6h.
  // (Reemplaza el volcado estimado cada 3 min de costTracker, que pisaría los USD reales.)
  costSync.start();

  // Cron de seguimientos — corre cada 15 minutos (idempotent)
  let isFollowupRunning = false;
  setInterval(async () => {
    if (isFollowupRunning) {
      console.warn('⚠️  Previous followup still running, skipping this cycle');
      return;
    }
    isFollowupRunning = true;
    try {
      await runFollowUps();
    } catch (err) {
      console.error('❌ Follow-up service error:', err.message);
    } finally {
      isFollowupRunning = false;
    }
  }, 15 * 60 * 1000);
  console.log('⏰ Follow-up service activo — revisa cada 15 min');
});

module.exports = app;
