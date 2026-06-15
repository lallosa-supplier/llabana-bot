/**
 * costTracker.js — Seguimiento automático de costos del bot de Llabana.
 *
 * - Captura tokens de Claude y mensajes de Twilio conforme ocurren (en memoria).
 * - Cada pocos minutos vuelca los acumulados a la pestaña "8 Costos" de Google Sheets.
 * - Expone getCosts() para que el dashboard los lea vía GET /api/costs.
 *
 * La pestaña "8 Costos" y sus encabezados se crean solos la primera vez.
 *
 * Columnas (A–J):
 *   A Mes (YYYY-MM) | B Railway USD | C Twilio msgs | D Twilio USD
 *   E Claude tok in | F Claude tok out | G Claude USD | H Otros USD
 *   I Total USD | J Actualizado
 */

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET = '8 Costos';

// Tarifas en USD — configurables por variables de entorno (con valores por defecto)
const RATES = {
  railwayMonthly: parseFloat(process.env.RAILWAY_MONTHLY_USD || '5'),
  sheetsMonthly:  parseFloat(process.env.SHEETS_MONTHLY_USD  || '0'),
  twilioNumber:   parseFloat(process.env.TWILIO_NUMBER_USD   || '1.15'),
  twilioPerMsg:   parseFloat(process.env.TWILIO_PER_MSG_USD  || '0.005'),
  claudeInPerM:   parseFloat(process.env.CLAUDE_INPUT_PER_M  || '3'),
  claudeOutPerM:  parseFloat(process.env.CLAUDE_OUTPUT_PER_M || '15'),
};

// Acumulador en memoria de deltas aún no guardados, por mes
const pending = {}; // { '2026-06': { twilioMsgs, claudeIn, claudeOut } }
let headersReady = false;

// ── Helpers de fecha ──────────────────────────────────────────────────────────

function ymNow() {
  return new Date()
    .toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' })
    .slice(0, 7); // YYYY-MM
}
function nowStamp() {
  return new Date()
    .toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' })
    .slice(0, 16);
}
function bucket() {
  const k = ymNow();
  if (!pending[k]) pending[k] = { twilioMsgs: 0, claudeIn: 0, claudeOut: 0 };
  return pending[k];
}

// ── Registro de eventos (llamado desde el bot) ────────────────────────────────

function recordClaudeUsage(inputTokens = 0, outputTokens = 0) {
  const b = bucket();
  b.claudeIn  += inputTokens  || 0;
  b.claudeOut += outputTokens || 0;
}
function recordTwilioMessage(n = 1) {
  bucket().twilioMsgs += n;
}

// ── Sheets ────────────────────────────────────────────────────────────────────

function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureSheet(sheets) {
  if (headersReady) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === SHEET);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: SHEET } } }] },
    });
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A1:J1`,
  });
  if (!res.data.values || !res.data.values.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A1:J1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[
        'Mes', 'Railway USD', 'Twilio msgs', 'Twilio USD',
        'Claude tok in', 'Claude tok out', 'Claude USD', 'Otros USD',
        'Total USD', 'Actualizado',
      ]] },
    });
  }
  headersReady = true;
}

async function readRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A:J`,
  });
  return res.data.values || [];
}

function rowToObj(r) {
  return {
    ym:         r[0] || '',
    twilioMsgs: +r[2] || 0,
    claudeIn:   +r[4] || 0,
    claudeOut:  +r[5] || 0,
    otros:      +r[7] || 0,
  };
}

function computeUsd(o) {
  const twilioUsd = RATES.twilioNumber + o.twilioMsgs * RATES.twilioPerMsg;
  const claudeUsd = o.claudeIn * RATES.claudeInPerM / 1e6 + o.claudeOut * RATES.claudeOutPerM / 1e6;
  const total = RATES.railwayMonthly + twilioUsd + claudeUsd + RATES.sheetsMonthly + (o.otros || 0);
  return { twilioUsd, claudeUsd, total };
}

// ── Volcado periódico a Sheets ────────────────────────────────────────────────

async function flush() {
  const keys = Object.keys(pending).filter(k => {
    const d = pending[k];
    return d.twilioMsgs || d.claudeIn || d.claudeOut;
  });
  if (!keys.length) return;

  try {
    const sheets = getSheets();
    await ensureSheet(sheets);
    const rows = await readRows(sheets);

    for (const k of keys) {
      const snap = { ...pending[k] }; // congelar delta; lo que llegue durante el flush se conserva

      const idx = rows.findIndex((r, i) => i > 0 && r[0] === k); // fila (0-based en el arreglo)
      const base = idx > 0
        ? rowToObj(rows[idx])
        : { ym: k, twilioMsgs: 0, claudeIn: 0, claudeOut: 0, otros: 0 };

      base.twilioMsgs += snap.twilioMsgs;
      base.claudeIn   += snap.claudeIn;
      base.claudeOut  += snap.claudeOut;

      const c = computeUsd(base);
      const out = [
        k,
        RATES.railwayMonthly,
        base.twilioMsgs,
        +c.twilioUsd.toFixed(4),
        base.claudeIn,
        base.claudeOut,
        +c.claudeUsd.toFixed(4),
        base.otros || 0,
        +c.total.toFixed(2),
        nowStamp(),
      ];

      if (idx > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET}!A${idx + 1}:J${idx + 1}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [out] },
        });
      } else {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET}!A:J`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [out] },
        });
      }

      // restar el snapshot ya guardado (conserva incrementos concurrentes)
      pending[k].twilioMsgs -= snap.twilioMsgs;
      pending[k].claudeIn   -= snap.claudeIn;
      pending[k].claudeOut  -= snap.claudeOut;
    }
  } catch (err) {
    console.error('costTracker.flush error:', err.message);
  }
}

// ── Lectura para el dashboard (/api/costs) ────────────────────────────────────

// Fuente de la verdad: los USD reales ya guardados en "8 Costos" (los escribe
// costSync con datos facturados de Twilio/Anthropic). NO recalcula desde conteos.
async function getCosts() {
  const sheets = getSheets();
  await ensureSheet(sheets);
  const rows = await readRows(sheets);

  return rows.slice(1)
    .filter(r => r[0])
    .map(r => {
      const railway = +r[1] || 0;  // B
      const twilio  = +r[3] || 0;  // D
      const claude  = +r[6] || 0;  // G
      const otros   = +r[7] || 0;  // H
      const total   = (r[8] !== undefined && r[8] !== '')
        ? (+r[8] || 0)             // I
        : railway + twilio + claude + otros + RATES.sheetsMonthly;
      return {
        ym:      r[0],
        railway,
        twilio,
        claude,
        sheets:  RATES.sheetsMonthly,
        otros,
        total,
        twilioMsgs: +r[2] || 0,    // C (sublínea)
        claudeIn:   +r[4] || 0,    // E (sublínea)
        claudeOut:  +r[5] || 0,    // F (sublínea)
      };
    })
    // Ocultar meses sin actividad real (solo el fijo de Railway, sin consumo de
    // Twilio/Claude ni conteos): así la tabla arranca en el primer mes con gasto.
    .filter(o =>
      o.twilio > 0 || o.claude > 0 || o.otros > 0 ||
      o.twilioMsgs > 0 || o.claudeIn > 0 || o.claudeOut > 0
    )
    .sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
}

// ── Arranque ──────────────────────────────────────────────────────────────────

function start() {
  setInterval(flush, 3 * 60 * 1000); // vuelca cada 3 minutos
  process.on('SIGTERM', flush);
  process.on('SIGINT', flush);
  console.log('💰 costTracker iniciado — volcado cada 3 min a la pestaña "8 Costos"');
}

module.exports = {
  recordClaudeUsage,
  recordTwilioMessage,
  getCosts,
  flush,
  start,
  // helpers reutilizados por costSync.js
  getSheets,
  ensureSheet,
  readRows,
  RATES,
  SHEET,
  SPREADSHEET_ID,
};
