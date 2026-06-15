/**
 * costSync.js — Sincroniza los costos REALES facturados (no estimados) hacia la
 * pestaña "8 Costos" de Google Sheets.
 *
 * - Twilio: usage records reales (totalprice) por mes.
 * - Anthropic (Claude): organization cost_report real por mes.
 * - Railway: monto fijo mensual (RAILWAY_MONTHLY_USD).
 *
 * Esta es la fuente de la verdad del dinero; reemplaza al contador en memoria de
 * costTracker (que solo estima y arrancó hoy). Escribe meses pasados y el actual.
 *
 * Reutiliza las credenciales/helpers de Sheets de costTracker.js.
 */

const {
  getSheets, ensureSheet, readRows, RATES, SHEET, SPREADSHEET_ID,
} = require('./costTracker');

// ── Helpers de fecha ──────────────────────────────────────────────────────────

/**
 * Meses desde monthsBack atrás hasta el mes actual (inclusive), en UTC.
 * startISO = primer día del mes 00:00:00Z; endISO = primer día del mes siguiente.
 */
function monthRanges(monthsBack = 6) {
  const now = new Date();
  const baseY = now.getUTCFullYear();
  const baseM = now.getUTCMonth(); // 0-11
  const out = [];
  for (let i = monthsBack; i >= 0; i--) {
    const start = new Date(Date.UTC(baseY, baseM - i, 1, 0, 0, 0));
    const end   = new Date(Date.UTC(baseY, baseM - i + 1, 1, 0, 0, 0));
    out.push({
      ym:       start.toISOString().slice(0, 7), // YYYY-MM
      startISO: start.toISOString(),
      endISO:   end.toISOString(),
      start,
      end,
    });
  }
  return out;
}

function syncStamp() {
  return 'sync ' + new Date()
    .toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' })
    .slice(0, 16); // sync YYYY-MM-DD HH:MM
}

// ── Twilio: costo real del mes ────────────────────────────────────────────────

async function fetchTwilioMonth(startDate, endDate, debug = false) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.warn('⚠️  Twilio: faltan credenciales — se omite');
    return { usd: null, debug: null };
  }
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Usage/Records.json`;

  const recDebug = (r) => ({
    category: r.category, price: r.price, price_unit: r.price_unit,
    start_date: r.start_date, end_date: r.end_date, description: r.description,
  });
  const sumPrices = (records) => {
    let total = 0;
    for (const rec of (records || [])) {
      total += Math.abs(parseFloat(rec.price) || 0);
      if (rec.price_unit && String(rec.price_unit).toUpperCase() !== 'USD') {
        console.warn(`⚠️  Twilio price_unit no USD (${rec.price_unit}) en ${startDate}`);
      }
    }
    return total;
  };

  // 404 = periodo sin cuenta (la cuenta no existía antes de marzo 2026) → $0 limpio.
  // El "Total monthly spend" de la factura corresponde a Category=totalprice.
  let usd = 0, path = 'totalprice', records = [];
  const url1 = `${base}?Category=totalprice&StartDate=${startDate}&EndDate=${endDate}`;
  const r1 = await fetch(url1, { headers: { Authorization: auth } });
  if (r1.status === 404) return { usd: 0, debug: debug ? { range: `${startDate}→${endDate}`, status: 404, note: 'sin cuenta' } : null };
  if (!r1.ok) throw new Error(`Twilio totalprice HTTP ${r1.status}`);
  const j1 = await r1.json();
  if ((j1.usage_records || []).length) {
    records = j1.usage_records;
    usd = sumPrices(records);
  } else {
    // Fallback: todos los records sin Category, sumar price
    path = 'fallback';
    const url2 = `${base}?StartDate=${startDate}&EndDate=${endDate}`;
    const r2 = await fetch(url2, { headers: { Authorization: auth } });
    if (r2.status === 404) return { usd: 0, debug: debug ? { range: `${startDate}→${endDate}`, status: 404, note: 'sin cuenta' } : null };
    if (!r2.ok) throw new Error(`Twilio fallback HTTP ${r2.status}`);
    const j2 = await r2.json();
    records = j2.usage_records || [];
    usd = sumPrices(records);
  }

  let dbg = null;
  if (debug) {
    dbg = {
      range: `${startDate} → ${endDate}`,
      path,
      sumadosUsd: +usd.toFixed(4),
      summedRecords: records.map(recDebug),
    };
    // Desglose por categoría del mes (paginado, para ver TODO lo que compone el total)
    try {
      const breakdown = [];
      let next = `/2010-04-01/Accounts/${sid}/Usage/Records.json?StartDate=${startDate}&EndDate=${endDate}&PageSize=1000`;
      let guard = 0;
      while (next && guard < 10) {
        const rb = await fetch(`https://api.twilio.com${next}`, { headers: { Authorization: auth } });
        if (!rb.ok) break;
        const jb = await rb.json();
        for (const r of (jb.usage_records || [])) {
          if (parseFloat(r.price)) breakdown.push({ category: r.category, price: r.price, description: r.description });
        }
        next = jb.next_page_uri || null;
        guard++;
      }
      dbg.breakdown = breakdown;
    } catch (e) { dbg.breakdownError = e.message; }
  }

  return { usd, debug: dbg };
}

// ── Anthropic: costo real del mes ─────────────────────────────────────────────

async function fetchAnthropicMonth(startISO, endISO) {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) {
    console.warn('⚠️  ANTHROPIC_ADMIN_KEY no configurada — se omite Claude en el sync (se conserva el valor previo de la fila)');
    return null;
  }

  let rawTotal = 0;
  const byWorkspace = {};
  const statuses = [];
  let pages = 0, buckets = 0, results = 0;
  let page = null;
  const MAX_PAGES = 100; // tope de seguridad anti-loop

  // Pagina mientras has_more: cost_report devuelve buckets diarios y los parte en
  // páginas; leer solo la primera dejaba el mes corto (junio salía ~$19 vs ~$73).
  do {
    const params = new URLSearchParams({ starting_at: startISO, ending_at: endISO });
    params.append('group_by[]', 'workspace_id');
    if (page) params.set('page', page);
    const url = `https://api.anthropic.com/v1/organizations/cost_report?${params.toString()}`;

    const res = await fetch(url, {
      headers: { 'anthropic-version': '2023-06-01', 'x-api-key': key },
    });
    statuses.push(res.status);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    pages++;

    for (const bucket of (json.data || [])) {
      buckets++;
      for (const result of (bucket.results || [])) {
        results++;
        const amt = parseFloat(result.amount) || 0;
        rawTotal += amt;
        const ws = result.workspace_id || 'sin-workspace';
        byWorkspace[ws] = (byWorkspace[ws] || 0) + amt;
      }
    }

    page = json.has_more ? json.next_page : null;
  } while (page && pages < MAX_PAGES);

  // La doc indica que los montos vienen en la unidad mínima (centavos): USD = suma/100.
  // Divisor configurable por si Anthropic cambiara el formato (default 100).
  const divisor = parseFloat(process.env.ANTHROPIC_COST_DIVISOR) || 100;
  const usd = rawTotal / divisor;
  const debug = {
    rango: `${startISO} → ${endISO}`,
    statuses, pages, buckets, results,
    rawTotal, divisor, usd: +usd.toFixed(4),
    byWorkspaceUsd: Object.fromEntries(
      Object.entries(byWorkspace).map(([k, v]) => [k, +(v / divisor).toFixed(2)])
    ),
  };
  console.log(`💵 Anthropic ${startISO.slice(0, 10)}→${endISO.slice(0, 10)}: pages=${pages} buckets=${buckets} results=${results} crudo=${rawTotal} → $${usd.toFixed(2)} USD`);
  Object.entries(byWorkspace).forEach(([ws, amt]) => {
    console.log(`   workspace ${ws}: crudo=${amt} → $${(amt / divisor).toFixed(2)} USD`);
  });
  return { usd, debug };
}

// ── Escritura a "8 Costos" ────────────────────────────────────────────────────

/**
 * Escribe/actualiza la fila del mes. Conserva conteos (C/E/F) y Otros (H) si la
 * fila ya existía. Si railway/twilioUsd/claudeUsd llegan null, conserva el valor
 * previo de esa columna (no lo pisa con 0).
 */
async function upsertMonth(ym, { railway, twilioUsd, claudeUsd }) {
  const sheets = getSheets();
  await ensureSheet(sheets);
  const rows = await readRows(sheets);

  const idx = rows.findIndex((r, i) => i > 0 && r[0] === ym);
  const ex  = idx > 0 ? rows[idx] : [];

  // Conservar conteos y otros tal cual estaban
  const twilioMsgs = ex[2] !== undefined ? ex[2] : '';
  const claudeIn   = ex[4] !== undefined ? ex[4] : '';
  const claudeOut  = ex[5] !== undefined ? ex[5] : '';
  const otros      = +ex[7] || 0;

  // null → conservar lo previo
  const railwayUsd = (railway   == null) ? (+ex[1] || 0) : +(+railway).toFixed(2);
  const twilioFin  = (twilioUsd == null) ? (+ex[3] || 0) : +(+twilioUsd).toFixed(4);
  const claudeFin  = (claudeUsd == null) ? (+ex[6] || 0) : +(+claudeUsd).toFixed(4);

  const total = railwayUsd + twilioFin + claudeFin + RATES.sheetsMonthly + otros;

  const out = [
    ym,                       // A
    railwayUsd,               // B
    twilioMsgs,               // C (conteo, intacto)
    twilioFin,                // D
    claudeIn,                 // E (conteo, intacto)
    claudeOut,                // F (conteo, intacto)
    claudeFin,                // G
    otros,                    // H
    +total.toFixed(2),        // I
    syncStamp(),              // J
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

  return { ym, railway: railwayUsd, twilioUsd: twilioFin, claudeUsd: claudeFin, total: +total.toFixed(2) };
}

// ── Orquestación ──────────────────────────────────────────────────────────────

async function syncAll(monthsBack = 6, opts = {}) {
  const debug = !!opts.debug;
  const ranges = monthRanges(monthsBack);
  const hasAdmin = !!process.env.ANTHROPIC_ADMIN_KEY;

  // Meses en paralelo: cada upsertMonth actualiza su propia fila (rango distinto),
  // así el endpoint responde rápido y no choca con el timeout del proxy (502).
  const summary = await Promise.all(ranges.map(async (m) => {
    try {
      const startDate = m.startISO.slice(0, 10);
      // Último día del mes = día anterior al primer día del mes siguiente.
      const endDate = new Date(m.end.getTime() - 86400000).toISOString().slice(0, 10);

      let twilioUsd = null, twilioStatus = 'ok', twilioDebug = null;
      try {
        const tw = await fetchTwilioMonth(startDate, endDate, debug);
        twilioUsd = tw.usd; twilioDebug = tw.debug;
      }
      catch (e) { twilioStatus = `error: ${e.message}`; console.error(`Twilio ${m.ym} error: ${e.message}`); }

      let claudeUsd = null, claudeStatus = hasAdmin ? 'ok' : 'no-admin-key', claudeDebug = null;
      try {
        const cr = await fetchAnthropicMonth(m.startISO, m.endISO);
        if (cr) { claudeUsd = cr.usd; claudeDebug = cr.debug; }
      }
      catch (e) { claudeStatus = `error: ${e.message}`; console.error(`Anthropic ${m.ym} error: ${e.message}`); }

      const res = await upsertMonth(m.ym, {
        railway: RATES.railwayMonthly, twilioUsd, claudeUsd,
      });
      console.log(`✅ sync ${m.ym}: Railway $${res.railway} | Twilio $${twilioUsd ?? '(prev)'} [${twilioStatus}] | Claude $${claudeUsd ?? '(prev)'} [${claudeStatus}] | Total $${res.total}`);
      const out = { ...res, twilioStatus, claudeStatus };
      if (debug) { out.twilioDebug = twilioDebug; out.claudeDebug = claudeDebug; }
      return out;
    } catch (e) {
      console.error(`sync ${m.ym} error: ${e.message}`);
      return { ym: m.ym, error: e.message };
    }
  }));

  return summary;
}

// ── Arranque ──────────────────────────────────────────────────────────────────

function start() {
  // ~30s después del boot para no bloquear el arranque
  setTimeout(() => {
    syncAll().catch(e => console.error('costSync inicial error:', e.message));
  }, 30 * 1000);
  // luego cada 6 horas
  setInterval(() => {
    syncAll().catch(e => console.error('costSync periódico error:', e.message));
  }, 6 * 60 * 60 * 1000);
  console.log('🔄 costSync iniciado — costos reales (Twilio + Anthropic) ~30s tras boot y cada 6h');
}

module.exports = {
  monthRanges,
  fetchTwilioMonth,
  fetchAnthropicMonth,
  upsertMonth,
  syncAll,
  start,
};
