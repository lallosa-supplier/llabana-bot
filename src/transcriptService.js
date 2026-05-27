const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET = '5 Transcripciones';

// Google Sheets tiene límite de ~50 000 caracteres por celda.
// Transcripts largos causan "Internal error encountered" — truncar preventivamente.
const MAX_CELL_CHARS = 48000;
function truncarTranscript(t) {
  if (!t || t.length <= MAX_CELL_CHARS) return t;
  return t.slice(0, MAX_CELL_CHARS) + '\n...[transcript truncado por límite de celda]';
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

async function saveTranscript(nombre, telefono, transcript) {
  const sheets = getSheets();
  const fecha = new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A:D`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[fecha, nombre, telefono, truncarTranscript(transcript)]]
    }
  });
}

async function getTranscripts() {
  const sheets = getSheets();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A2:D`,
  });

  const rows = res.data.values || [];
  return rows
    .filter(r => r[0] || r[1] || r[2])
    .map(r => ({
      fecha:      r[0] || '',
      nombre:     r[1] || '',
      telefono:   r[2] || '',
      transcript: r[3] || '',
    }))
    .sort((a, b) => {
      // Parsear fechas en formato "DD/MM/YYYY HH:MM"
      const parsefecha = (f) => {
        if (!f) return 0;
        const [datePart, timePart] = f.split(', ');
        if (!datePart || !timePart) return 0;
        const [dd, mm, yyyy] = datePart.split('/');
        const [hh, min] = timePart.split(':');
        return new Date(yyyy, mm - 1, dd, hh, min).getTime();
      };
      return parsefecha(b.fecha) - parsefecha(a.fecha); // más reciente primero
    });
}

async function getExistingTranscript(telefono) {
  const sheets = getSheets();
  const tel10 = telefono.replace('whatsapp:', '').replace(/\D/g, '').slice(-10);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A2:D`,
  });

  const rows = res.data.values || [];
  const row = rows.find(r => (r[2] || '').replace(/\D/g, '').slice(-10) === tel10);
  return row ? (row[3] || '') : '';
}

async function updateTranscript(telefono, nombre, transcript) {
  const sheets = getSheets();
  const telefono_clean = telefono.replace('whatsapp:', '').replace(/^\+?52/, '');

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A2:D`,
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => (r[2] || '').replace(/^\+?52/, '').replace(/\D/g, '').slice(-10) === telefono_clean.replace(/\D/g, '').slice(-10));

  const fecha = new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  if (rowIndex !== -1) {
    const sheetRow = rowIndex + 2; // +1 por header, +1 por base-1
    // Usar el nombre que ya existe en Sheets si el nuevo llega vacío
    const nombreFinal = nombre || rows[rowIndex][1] || '';
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A${sheetRow}:D${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[fecha, nombreFinal, rows[rowIndex][2] || '', truncarTranscript(transcript)]]
      }
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A:D`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[fecha, nombre || '', telefono, truncarTranscript(transcript)]]
      }
    });
  }
}

module.exports = { saveTranscript, getTranscripts, updateTranscript, getExistingTranscript };
