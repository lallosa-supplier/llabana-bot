const botLogic    = require('./botLogic');
const twilioService = require('./twilioService');
const { updateTranscript, getExistingTranscript } = require('./transcriptService');
const sessionManager = require('./sessionManager');
const sheetsService = require('./sheetsService');
const { handleWigCommand, isWigCommand } = require('./wigAdminHandler');

/**
 * Maneja el webhook POST de Twilio para mensajes de WhatsApp entrantes.
 *
 * Twilio envía un body form-encoded con estos campos clave:
 *   From  → número del remitente (ej. whatsapp:+521234567890)
 *   To    → número del bot
 *   Body  → texto del mensaje
 *
 * Respondemos con 200 inmediatamente para evitar timeouts de Twilio (15s),
 * y procesamos el mensaje de forma asíncrona.
 *
 * Debounce: acumula mensajes del mismo número durante 3s antes de procesar,
 * para manejar mensajes enviados en ráfaga como un solo input concatenado.
 */

// Deduplicación: guarda los últimos 100 MessageSid procesados
const processedSids = new Set();
const MAX_SIDS = 100;

const chatLogs = new Map();

// Limpiar chatLogs inactivos cada 2 horas
setInterval(() => {
  const DOS_HORAS = 2 * 60 * 60 * 1000;
  const ahora = Date.now();
  let limpiados = 0;
  for (const [phone, log] of chatLogs.entries()) {
    if (ahora - (log.lastActivity || 0) > DOS_HORAS) {
      chatLogs.delete(phone);
      limpiados++;
    }
  }
  if (limpiados > 0) {
    console.log(`🧹 chatLogs limpiados: ${limpiados} entradas | quedan: ${chatLogs.size}`);
  }
}, 2 * 60 * 60 * 1000).unref();

// Debounce: { from → { timer, messages[] } }
const pendingMessages = new Map();

// Lock: evita procesamiento paralelo del mismo número
const processingLocks = new Map();

// Transcripción para el dashboard de Wig — NO-crítica. Corre en SEGUNDO PLANO (fire-and-
// forget) con su propio try/catch: nunca bloquea la respuesta al cliente, nunca retiene el
// lock, y un fallo/cuelgue de Sheets (ya acotado por timeout en transcriptService) jamás
// propaga al flujo del mensaje. Se llama DESPUÉS de responder al cliente.
async function grabarTranscripcion(from, body, reply) {
  try {
    if (!chatLogs.has(from)) {
      const previo = await getExistingTranscript(from); // timeout-guarded, devuelve '' si falla
      const lines = previo ? previo.split('\n').filter(Boolean) : [];
      chatLogs.set(from, { lines, lastActivity: Date.now() });
    }
    const log = chatLogs.get(from);
    log.lines.push(`Cliente: ${body}`);
    log.lines.push(`Bot: ${reply}`);
    log.lastActivity = Date.now();

    let nombre = '';
    try {
      const session = await sessionManager.getSession(from);
      nombre = session?.customer?.name || session?.tempData?.name || '';
      if (!nombre) {
        const maestro = await sheetsService.findCustomer(from); // findCustomer ya tiene timeout 10s
        if (maestro?.name) nombre = maestro.name;
      }
    } catch (e) { /* nombre queda ''; no bloquea */ }

    await updateTranscript(from.replace('whatsapp:', ''), nombre, log.lines.join('\n'));
  } catch (err) {
    console.error('📝 Transcripción (no-crítica) falló, sigo:', err.message);
  }
}

async function procesarMensaje(from, body) {
  if (processingLocks.has(from)) {
    console.log(`⏳ Mensaje de ${from} ignorado — procesamiento en curso`);
    return;
  }
  processingLocks.set(from, true);
  try {
    // Ventana de WhatsApp: CUALQUIER mensaje de Wig o del número de respaldo (comando
    // o no) reabre su ventana de 24h. Guardamos el timestamp en Redis para que
    // notifyWig sepa si todavía puede escribirles (ver botLogic.notifyWig).
    const fromDigits   = from.replace(/\D/g, '').slice(-10);
    const wigDigits    = (process.env.WIG_WHATSAPP_NUMBER    || '').replace(/\D/g, '').slice(-10);
    const backupDigits = (process.env.BACKUP_WHATSAPP_NUMBER || '').replace(/\D/g, '').slice(-10);
    const esWig    = wigDigits    && fromDigits === wigDigits;
    const esBackup = backupDigits && fromDigits === backupDigits;
    if (esWig || esBackup) {
      try {
        const redis = sessionManager.getRedisClient && sessionManager.getRedisClient();
        if (redis) {
          await redis.set(esWig ? 'wig:lastInbound' : 'backup:lastInbound', String(Date.now()));
        }
      } catch (e) {
        console.error('No se pudo registrar ventana de Wig/respaldo:', e.message);
      }
    }

    // Comandos admin de Wig
    if (await isWigCommand(from, body)) {
      try {
        const respuesta = await handleWigCommand(body);
        await twilioService.sendMessage(from, respuesta);
        console.log(`🔧 [WIG-ADMIN] ${body.substring(0, 80)}`);
      } catch (err) {
        console.error('❌ [WIG-ADMIN] Error:', err.message);
        await twilioService.sendMessage(
          from,
          '❌ Error procesando el comando. Intenta de nuevo.'
        );
      }
      return;
    }

    // Ignorar mensajes no-comando de Wig o del número de respaldo. No son clientes;
    // su mensaje ya sirvió para reabrir su ventana de WhatsApp (registrado arriba).
    if (esWig || esBackup) {
      console.log(`🔧 [${esWig ? 'WIG' : 'BACKUP'}] Mensaje no-comando ignorado: ${body.substring(0, 50)}`);
      return;
    }

    // ── Lo ÚNICO crítico: atender al cliente ──
    const reply = await botLogic.handleMessage(from, body);
    await twilioService.sendMessage(from, reply);
    console.log(`📤 [${from}]: ${reply.substring(0, 120)}${reply.length > 120 ? '…' : ''}`);

    // Transcripción (dashboard): fire-and-forget — NO se espera, NO retiene el lock,
    // NO puede colgar el flujo. Un fallo de Sheets aquí es inofensivo.
    grabarTranscripcion(from, body, reply).catch(() => {});
  } catch (err) {
    console.error(`❌ Error procesando mensaje de ${from}:`, err);
    try {
      await twilioService.sendMessage(
        from,
        'Disculpa, tuve un problema técnico. Por favor intenta de nuevo en un momento.'
      );
    } catch (sendErr) {
      console.error('Error enviando mensaje de fallo:', sendErr.message);
    }
  } finally {
    processingLocks.delete(from);
  }
}

async function webhookHandler(req, res) {
  // Responder a Twilio de inmediato
  res.status(200).send('');

  // Deduplicar por MessageSid para evitar doble procesamiento
  const sid = req.body?.MessageSid;
  if (sid) {
    if (processedSids.has(sid)) {
      console.log(`⚠️  SID duplicado ignorado: ${sid}`);
      return;
    }
    processedSids.add(sid);
    if (processedSids.size > MAX_SIDS) {
      processedSids.delete(processedSids.values().next().value);
    }
  }

  const from = req.body?.From;
  let body = (req.body?.Body || '').trim();

  if (!from) {
    console.log('Webhook recibido sin From:', JSON.stringify(req.body));
    return;
  }

  // Media sin texto (imagen/audio/pdf): no procesamos el contenido del archivo
  // todavía, pero enrutamos al cerebro IA con un texto sintético para que
  // responda con naturalidad (mismo pipeline que el texto normal).
  const numMedia = parseInt(req.body?.NumMedia || '0', 10);
  const hasMedia = numMedia > 0 || !!req.body?.MediaContentType0;
  if (!body) {
    if (hasMedia) {
      const mediaType = req.body?.MediaContentType0 || '';
      const tipo = /audio|voice/i.test(mediaType) ? 'audio'
                 : /pdf|document/i.test(mediaType) ? 'archivo'
                 : 'imagen';
      body = `[El cliente envió un ${tipo} sin texto]`;
      console.log(`📎 Media sin texto de ${from}: ${mediaType || 'desconocido'} → cerebro IA`);
    } else {
      // Mensaje totalmente vacío (sin texto ni media): ignorar.
      console.log(`Webhook sin texto ni media de ${from}`);
      return;
    }
  }

  console.log(`📨 [${from}]: ${body}`);

  // NOTA: la transcripción (chatLogs/Sheets) ya NO se toca aquí. Antes había un
  // `await getExistingTranscript` sin timeout ANTES del debounce que, si Sheets se
  // colgaba, dropeaba el mensaje sin error. Ahora la transcripción corre en segundo
  // plano dentro de procesarMensaje (grabarTranscripcion), fuera del camino crítico.

  // Debounce: acumular mensajes y procesar tras 3s de silencio
  const pending = pendingMessages.get(from) || { timer: null, messages: [] };
  pending.messages.push(body);
  if (pending.timer) clearTimeout(pending.timer);

  pending.timer = setTimeout(async () => {
    const entry = pendingMessages.get(from);
    if (!entry) return;
    const mensajeCompleto = entry.messages.join(' ');
    pendingMessages.delete(from);  // Limpiar siempre, incluso si hay error
    try {
      await procesarMensaje(from, mensajeCompleto);
    } catch (err) {
      console.error('[webhookHandler] Error en procesarMensaje:', err.message);
      // El lock será limpiado por el finally en procesarMensaje
    }
  }, 1500);

  pendingMessages.set(from, pending);
}

module.exports = webhookHandler;
