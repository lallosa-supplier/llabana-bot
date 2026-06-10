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

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET = '5 Transcripciones';
const SHEET_MAESTRO = '1 Base Maestra';
const MAESTRO_NOMBRE = 1;   // columna B
const MAESTRO_TELEFONO = 3; // columna D
const PAUSA_MS = 250; // pausa entre escrituras para no pasar el rate limit

/** Últimos 10 dígitos del teléfono (misma normalización que sheetsService). */
function normPhone(phone) {
  let n = (phone || '').replace('whatsapp:', '').replace(/\D/g, '');
  if (n.length > 10) n = n.slice(-10);
  return n;
}

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

  // 1) Leer el Sheet maestro UNA sola vez y armar mapa teléfono → nombre.
  const resM = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_MAESTRO}!A:S`,
  });
  const filasM = resM.data.values || [];
  const mapa = new Map();
  for (let i = 1; i < filasM.length; i++) {
    const tel = normPhone(filasM[i][MAESTRO_TELEFONO]);
    const nom = (filasM[i][MAESTRO_NOMBRE] || '').trim();
    if (tel && nom && !mapa.has(tel)) mapa.set(tel, nom);
  }
  console.log(`Maestro: ${filasM.length - 1} filas, ${mapa.size} con teléfono+nombre`);

  // 2) Leer transcripciones.
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
    const nombreMaestro = mapa.get(normPhone(telefono));

    if (!nombreMaestro) {
      sinNombreEnMaestro++;
      continue;
    }

    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET}!B${sheetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[nombreMaestro]] },
      });
      rellenadas++;
      console.log(`  ✓ fila ${sheetRow} (${telefono}) → "${nombreMaestro}"`);
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
