/**
 * costTracker.js — Acceso a la pestaña "8 Costos" de Google Sheets.
 *
 * Provee los helpers de Sheets (getSheets/ensureSheet/readRows) que reutiliza
 * costSync, y getCosts() que alimenta el dashboard (GET /api/costs) leyendo los
 * USD REALES ya escritos por costSync. La pestaña y sus encabezados se crean solos.
 *
 * El antiguo contador en vivo (recordClaudeUsage/recordTwilioMessage + flush) se
 * eliminó: la fuente de la verdad es costSync (Twilio totalprice real + Claude del
 * bot por usage_report). Los conteos C/E/F también los escribe ahora costSync.
 *
 * Columnas (A–J):
 *   A Mes (YYYY-MM) | B Railway USD | C Twilio msgs | D Twilio USD
 *   E Claude tok in | F Claude tok out | G Claude USD | H Otros USD
 *   I Total USD | J Actualizado
 */

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET = '8 Costos';

// Montos fijos mensuales (USD), configurables por env. Los costos variables
// (Twilio, Claude) son reales y los escribe costSync; aquí solo viven los fijos.
const RATES = {
  railwayMonthly: parseFloat(process.env.RAILWAY_MONTHLY_USD || '5'),
  sheetsMonthly:  parseFloat(process.env.SHEETS_MONTHLY_USD  || '0'),
};

let headersReady = false;

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

// ── Lectura para el dashboard (/api/costs) ────────────────────────────────────

// Fuente de la verdad: los USD reales ya guardados en "8 Costos" (los escribe
// costSync). NO recalcula nada. Los conteos C/E/F (sublíneas) salen null si la
// celda está vacía, para que el dashboard oculte la sublínea en vez de mostrar 0.
async function getCosts() {
  const sheets = getSheets();
  await ensureSheet(sheets);
  const rows = await readRows(sheets);

  const numOrNull = (v) => (v === undefined || v === '') ? null : (+v || 0);

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
        twilioMsgs: numOrNull(r[2]),  // C (sublínea; hoy no se mide → null)
        claudeIn:   numOrNull(r[4]),  // E (sublínea; tokens reales del bot)
        claudeOut:  numOrNull(r[5]),  // F (sublínea)
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

module.exports = {
  getCosts,
  // helpers reutilizados por costSync.js
  getSheets,
  ensureSheet,
  readRows,
  RATES,
  SHEET,
  SPREADSHEET_ID,
};
