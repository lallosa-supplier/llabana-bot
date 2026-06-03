/**
 * limpiarDuplicados.js
 *
 * Script standalone — correr UNA sola vez para limpiar la Base Maestra.
 * Agrupa por teléfono, consolida la mejor info, corrige nombres con bugs
 * y borra las filas duplicadas de abajo hacia arriba.
 *
 * Uso:
 *   node src/scripts/limpiarDuplicados.js
 */

require('dotenv').config();
const { google } = require('googleapis');
const readline   = require('readline');
const fs         = require('fs');
const path       = require('path');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_NAME     = '1 Base Maestra';
const TELEFONOS_EXCLUIDOS = new Set([
  '+524424337967', // número de sucursal
  '+522722202518', // excepción manual
]);

// ── Índices de columnas (0-based) ─────────────────────────────────────────────

const COL = {
  SEGMENTO:     0,
  NOMBRE:       1,
  EMAIL:        2,
  TELEFONO:     3,
  ACE_EMAIL:    4,
  ACE_WA:       5,
  ESTADO:       6,
  CIUDAD:       7,
  CP:           8,
  TOTAL_ORD:    9,
  MONTO:        10,
  FECHA_COMPRA: 11,
  ORIGEN:       12,
  ENTRADA:      13,
  TAGS:         14,
  FECHA_REG:    15,
  ASESORIA:     16,
  NOTAS:        17,
  ULTIMO_MOV:   18,
};

const NUM_COLS = 19; // A:S

const JERARQUIA_SEGMENTO = [
  'Recompra',
  'Comprador',
  'Mayoreo / Reventa',
  'Carrito abandonado',
  'Solo cuenta',
  'Redirigido a sucursal',
  'Lead frío',
  'Solo teléfono',
  '',
];

// ── Auth ──────────────────────────────────────────────────────────────────────

function getAuth() {
  let credentials;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
  } else {
    throw new Error('Faltan credenciales de Google (GOOGLE_SERVICE_ACCOUNT_JSON)');
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheets() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

// ── Leer sheet ────────────────────────────────────────────────────────────────

async function leerSheet(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range:         `${SHEET_NAME}!A:S`,
  });
  return res.data.values || [];
}

// ── sheetId numérico ──────────────────────────────────────────────────────────

async function getNumericSheetId(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  for (const s of meta.data.sheets) {
    if (s.properties.title === SHEET_NAME) return s.properties.sheetId;
  }
  throw new Error(`Sheet "${SHEET_NAME}" no encontrada`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function get(fila, col) {
  return (fila[col] || '').toString().trim();
}

function primerNoVacio(...vals) {
  return vals.find(v => v && v.trim()) || '';
}

function fechaMayor(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function fechaMenor(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function rangoSegmento(seg) {
  const idx = JERARQUIA_SEGMENTO.indexOf(seg);
  return idx === -1 ? JERARQUIA_SEGMENTO.length : idx;
}

// ── Corrección de nombres con bugs ────────────────────────────────────────────

const BUGS = {
  'Sí':                        '',
  'Si':                        '',
  'Sí, Desde Naucalpan':       '',
  'Si, Desde Naucalpan':       '',
  'Jiutepec, Morelos. Susan.': 'Susan',
  'No Lic.':                   '',
  'Con Sergio Rosas':          'Sergio Rosas',
  'Con María':                 'María',
  'Con Maria':                 'María',
  'El Señor José Pedro':       'José Pedro',
  'Para Cerdos':               '',
  'Primera Ves':               '',
  'Primera Vez':               '',
};

function corregirNombre(nombre) {
  if (!nombre) return '';
  if (BUGS[nombre] !== undefined) return BUGS[nombre];
  return nombre
    .replace(/^(con|soy|me\s+llamo|el\s+se[ñn]or|la\s+se[ñn]ora|don|do[ñn]a)\s+/i, '')
    .replace(/[,.\s]+$/, '')
    .trim();
}

const NOMBRE_BUGGY = /^(sí|si|no|ok|para\s+\w+|con\s+|primera\s+ve[zs]|jiutepec|no\s+lic)/i;

function nombreValido(n) {
  if (!n) return false;
  if (NOMBRE_BUGGY.test(n)) return false;
  return true;
}

// ── Consolidar grupo de filas ─────────────────────────────────────────────────

function consolidar(filas) {
  // SEGMENTO — mayor jerarquía
  const segmento = filas
    .map(f => get(f, COL.SEGMENTO))
    .sort((a, b) => rangoSegmento(a) - rangoSegmento(b))[0] || '';

  // NOMBRE — el válido con más palabras (y más largo en empate)
  const nombresValidos = filas
    .map(f => get(f, COL.NOMBRE))
    .filter(nombreValido);
  const nombre = nombresValidos.sort((a, b) => {
    const diff = b.split(/\s+/).length - a.split(/\s+/).length;
    return diff !== 0 ? diff : b.length - a.length;
  })[0] || '';

  // EMAIL — únicos, unidos con " / "
  const emails = [...new Set(
    filas.map(f => get(f, COL.EMAIL)).filter(Boolean)
  )];
  const email = emails.join(' / ');

  // TELEFONO — primero no vacío
  const telefono = primerNoVacio(...filas.map(f => get(f, COL.TELEFONO)));

  // ACE_EMAIL, ACE_WA — 'SI' si alguno lo tiene
  const aceEmail = filas.some(f => get(f, COL.ACE_EMAIL).toUpperCase() === 'SI')
    ? 'SI'
    : primerNoVacio(...filas.map(f => get(f, COL.ACE_EMAIL)));
  const aceWa = filas.some(f => get(f, COL.ACE_WA).toUpperCase() === 'SI')
    ? 'SI'
    : primerNoVacio(...filas.map(f => get(f, COL.ACE_WA)));

  // ESTADO, CIUDAD, CP — primero no vacío
  const estado = primerNoVacio(...filas.map(f => get(f, COL.ESTADO)));
  const ciudad = primerNoVacio(...filas.map(f => get(f, COL.CIUDAD)));
  const cp     = primerNoVacio(...filas.map(f => get(f, COL.CP)));

  // TOTAL_ORD — el mayor
  const totalOrd = filas
    .map(f => parseInt(get(f, COL.TOTAL_ORD), 10) || 0)
    .sort((a, b) => b - a)[0] || 0;

  // MONTO — el mayor
  const monto = filas
    .map(f => parseFloat(get(f, COL.MONTO).replace(/[$,]/g, '')) || 0)
    .sort((a, b) => b - a)[0] || 0;

  // FECHA_COMPRA — la más reciente
  const fechaCompra = filas
    .map(f => get(f, COL.FECHA_COMPRA))
    .filter(Boolean)
    .reduce((acc, v) => fechaMayor(acc, v), '');

  // ORIGEN — primero no vacío
  const origen = primerNoVacio(...filas.map(f => get(f, COL.ORIGEN)));

  // ENTRADA — primero no vacío que no sea 'Directo'; si todos son Directo/vacío → 'Directo'
  const entradaNoDirecto = filas
    .map(f => get(f, COL.ENTRADA))
    .find(e => e && e !== 'Directo');
  const entrada = entradaNoDirecto || 'Directo';

  // TAGS — unir sin repetir
  const todosLosTags = filas.flatMap(f =>
    get(f, COL.TAGS).split(',').map(t => t.trim()).filter(Boolean)
  );
  const tags = [...new Set(todosLosTags)].join(', ');

  // FECHA_REG — la más antigua
  const fechaReg = filas
    .map(f => get(f, COL.FECHA_REG))
    .filter(Boolean)
    .reduce((acc, v) => fechaMenor(acc, v), '');

  // ASESORIA — concatenar todas no vacías
  const asesorias = filas.map(f => get(f, COL.ASESORIA)).filter(Boolean);
  const asesoria  = asesorias.join('\n---\n');

  // NOTAS — concatenar todas no vacías
  const notasArr = filas.map(f => get(f, COL.NOTAS)).filter(Boolean);
  const notas    = notasArr.join(' | ');

  // ULTIMO_MOV — el más reciente
  const ultimoMov = filas
    .map(f => get(f, COL.ULTIMO_MOV))
    .filter(Boolean)
    .reduce((acc, v) => fechaMayor(acc, v), '');

  // Construir fila resultado (19 columnas)
  const result = new Array(NUM_COLS).fill('');
  result[COL.SEGMENTO]     = segmento;
  result[COL.NOMBRE]       = nombre;
  result[COL.EMAIL]        = email;
  result[COL.TELEFONO]     = telefono;
  result[COL.ACE_EMAIL]    = aceEmail;
  result[COL.ACE_WA]       = aceWa;
  result[COL.ESTADO]       = estado;
  result[COL.CIUDAD]       = ciudad;
  result[COL.CP]           = cp;
  result[COL.TOTAL_ORD]    = totalOrd > 0 ? String(totalOrd) : '';
  result[COL.MONTO]        = monto > 0 ? String(monto) : '';
  result[COL.FECHA_COMPRA] = fechaCompra;
  result[COL.ORIGEN]       = origen;
  result[COL.ENTRADA]      = entrada;
  result[COL.TAGS]         = tags;
  result[COL.FECHA_REG]    = fechaReg;
  result[COL.ASESORIA]     = asesoria;
  result[COL.NOTAS]        = notas;
  result[COL.ULTIMO_MOV]   = ultimoMov;
  return result;
}

// ── Aplicar cambios ───────────────────────────────────────────────────────────

async function aplicarCambios(sheets, sheetId, cambiosDuplicados, correcciones) {
  // 1. Actualizar filas ganadoras (consolidadas) y correcciones de nombre
  const updateRequests = [];

  for (const { rowIndexGanador, filaConsolidada } of cambiosDuplicados) {
    updateRequests.push({
      range:  `${SHEET_NAME}!A${rowIndexGanador}:S${rowIndexGanador}`,
      values: [filaConsolidada],
    });
  }

  for (const { rowIndex, nombreNuevo, filaCurrent } of correcciones) {
    const filaActualizada = [...filaCurrent];
    filaActualizada[COL.NOMBRE] = nombreNuevo;
    updateRequests.push({
      range:  `${SHEET_NAME}!A${rowIndex}:S${rowIndex}`,
      values: [filaActualizada],
    });
  }

  if (updateRequests.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        valueInputOption: 'RAW',
        data: updateRequests,
      },
    });
    console.log(`  📝 ${updateRequests.length} filas actualizadas`);
  }

  // 2. Borrar filas duplicadas de abajo hacia arriba
  const filasBorrar = cambiosDuplicados
    .flatMap(c => c.filasABorrar)
    .sort((a, b) => b - a); // descendente

  let borradas = 0;
  for (const rowIndex of filasBorrar) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension:  'ROWS',
              startIndex: rowIndex - 1, // 0-based para la API
              endIndex:   rowIndex,
            },
          },
        }],
      },
    });
    borradas++;
    process.stdout.write(`\r  🗑️  Borrando filas: ${borradas}/${filasBorrar.length}`);
  }
  if (filasBorrar.length > 0) console.log();

  console.log(`\n✅ Cambios aplicados:`);
  console.log(`  - ${correcciones.length} nombres corregidos`);
  console.log(`  - ${cambiosDuplicados.length} grupos consolidados`);
  console.log(`  - ${filasBorrar.length} filas borradas`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('❌ GOOGLE_SHEETS_ID no está configurado en .env');
    process.exit(1);
  }

  const sheets = await getSheets();

  // 1. Leer sheet y hacer backup
  console.log('📖 Leyendo Base Maestra…');
  const allRows = await leerSheet(sheets);
  if (allRows.length < 2) {
    console.log('Sheet vacía o solo tiene header. Nada que hacer.');
    return;
  }

  const timestamp = Date.now();
  const backupPath = path.join('/tmp', `backup_base_maestra_${timestamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(allRows, null, 2));
  console.log(`💾 Backup guardado en ${backupPath}`);
  console.log(`   Total filas leídas: ${allRows.length} (incluyendo header)`);

  // 2. Separar header
  const header   = allRows[0];
  const dataRows = allRows.slice(1); // índice 0 = fila 2 del sheet (rowIndex = 2)

  // 3. Agrupar por teléfono
  const grupos = new Map(); // telefono → [{ rowIndex, fila }]
  for (let i = 0; i < dataRows.length; i++) {
    const rowIndex = i + 2; // 1-based, fila 1 es header
    const fila     = dataRows[i];
    const tel      = get(fila, COL.TELEFONO);
    if (!tel) continue;
    if (TELEFONOS_EXCLUIDOS.has(tel)) continue;
    if (!grupos.has(tel)) grupos.set(tel, []);
    grupos.get(tel).push({ rowIndex, fila });
  }

  // 4. Identificar duplicados y correcciones
  const cambiosDuplicados = []; // grupos con más de 1 fila
  const correcciones      = []; // filas sin duplicado con nombre a corregir

  for (const [tel, entradas] of grupos) {
    if (entradas.length > 1) {
      // Consolidar
      const filas           = entradas.map(e => e.fila);
      const filaConsolidada = consolidar(filas);
      const nombreCorregido = corregirNombre(filaConsolidada[COL.NOMBRE]);
      filaConsolidada[COL.NOMBRE] = nombreCorregido;

      // Fila ganadora = la de rowIndex más bajo
      entradas.sort((a, b) => a.rowIndex - b.rowIndex);
      const rowIndexGanador = entradas[0].rowIndex;
      const filasABorrar    = entradas.slice(1).map(e => e.rowIndex);

      cambiosDuplicados.push({
        tel,
        rowIndexGanador,
        filaConsolidada,
        filasABorrar,
        filasPrevias: entradas,
      });
    } else {
      // Sin duplicado — revisar nombre
      const { rowIndex, fila } = entradas[0];
      const nombreActual  = get(fila, COL.NOMBRE);
      const nombreNuevo   = corregirNombre(nombreActual);
      if (nombreNuevo !== nombreActual) {
        correcciones.push({ rowIndex, nombreActual, nombreNuevo, filaCurrent: fila });
      }
    }
  }

  // 5. Preview
  console.log('\n=== PREVIEW DE CAMBIOS ===\n');

  if (correcciones.length > 0) {
    console.log('NOMBRES A CORREGIR:');
    for (const c of correcciones) {
      console.log(`  Fila ${c.rowIndex}: "${c.nombreActual}" → "${c.nombreNuevo}"`);
    }
  } else {
    console.log('NOMBRES A CORREGIR: ninguno');
  }

  console.log('\nDUPLICADOS A CONSOLIDAR:');
  if (cambiosDuplicados.length === 0) {
    console.log('  ninguno');
  } else {
    for (const g of cambiosDuplicados) {
      console.log(`\n  Tel: ${g.tel}`);
      console.log(`    Filas: ${g.filasPrevias.map(e => e.rowIndex).join(', ')}`);
      console.log(`    Nombre consolidado: "${g.filaConsolidada[COL.NOMBRE]}"`);
      console.log(`    Segmento: "${g.filaConsolidada[COL.SEGMENTO]}"`);
      if (g.filaConsolidada[COL.EMAIL])
        console.log(`    Email: "${g.filaConsolidada[COL.EMAIL]}"`);
      console.log(`    Ganador: fila ${g.rowIndexGanador} → borrar filas: ${g.filasABorrar.join(', ')}`);
    }
  }

  const totalBorrar = cambiosDuplicados.reduce((acc, g) => acc + g.filasABorrar.length, 0);
  console.log(`\nRESUMEN:`);
  console.log(`  Nombres a corregir:    ${correcciones.length}`);
  console.log(`  Grupos de duplicados:  ${cambiosDuplicados.length}`);
  console.log(`  Filas a borrar:        ${totalBorrar}`);

  if (correcciones.length === 0 && cambiosDuplicados.length === 0) {
    console.log('\n✅ No hay cambios que aplicar.');
    return;
  }

  // 6. Confirmación
  const sheetId = await getNumericSheetId(sheets);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\n¿Aplicar cambios? (s/n): ', async (answer) => {
    rl.close();
    if (answer.toLowerCase() !== 's') {
      console.log('Cancelado. No se hizo ningún cambio.');
      return;
    }
    console.log('\nAplicando cambios…');
    await aplicarCambios(sheets, sheetId, cambiosDuplicados, correcciones);
  });
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
