/**
 * Backfill de nombres en la pestaña "5 Transcripciones".
 *
 * Rellena la columna B (nombre) de las filas que tienen teléfono (col C)
 * pero nombre vacío, buscando el nombre en el Sheet maestro vía
 * sheetsService.findCustomer.
 *
 * Solo escribe la columna B de transcripciones. NO toca el Sheet maestro.
 * Uso (una vez, con .env disponible):  node src/backfill-nombres.js
 */
require('dotenv').config();
const { google } = require('googleapis');
const sheetsService = require('./sheetsService');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET = '5 Transcripciones';
const PAUSA_MS = 200; // pausa entre escrituras para no pasar el rate limit

function getSheets() {
  let credentials;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
  } else {
    throw new Error('Faltan credenciales de Google');
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const sheets = getSheets();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A2:D`,
  });
  const rows = res.data.values || [];
  console.log(`Filas leídas en "${SHEET}": ${rows.length}`);

  let candidatas = 0, rellenadas = 0, sinNombreEnMaestro = 0, errores = 0;

  for (let i = 0; i < rows.length; i++) {
    const nombre   = (rows[i][1] || '').trim();
    const telefono = (rows[i][2] || '').trim();

    if (!telefono || nombre) continue; // solo filas con teléfono y sin nombre
    candidatas++;

    const sheetRow = i + 2; // +1 header, +1 base-1

    let maestro = null;
    try {
      maestro = await sheetsService.findCustomer(telefono);
    } catch (e) {
      errores++;
      console.error(`  ✗ fila ${sheetRow} (${telefono}): error buscando en maestro: ${e.message}`);
      continue;
    }

    if (!maestro?.name) {
      sinNombreEnMaestro++;
      continue;
    }

    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET}!B${sheetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[maestro.name]] },
      });
      rellenadas++;
      console.log(`  ✓ fila ${sheetRow} (${telefono}) → "${maestro.name}"`);
      await sleep(PAUSA_MS);
    } catch (e) {
      errores++;
      console.error(`  ✗ fila ${sheetRow} (${telefono}): error escribiendo: ${e.message}`);
    }
  }

  console.log('');
  console.log('=== RESUMEN BACKFILL ===');
  console.log(`Candidatas (teléfono sin nombre): ${candidatas}`);
  console.log(`Rellenadas:                       ${rellenadas}`);
  console.log(`Sin nombre en maestro:            ${sinNombreEnMaestro}`);
  console.log(`Errores:                          ${errores}`);
}

main().catch((e) => {
  console.error('ERROR FATAL:', e.message);
  process.exit(1);
});
