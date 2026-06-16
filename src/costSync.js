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

// ── Meses cerrados y validados (FUENTE DE LA VERDAD) ──────────────────────────
// Valores reales en USD ya cotejados contra la consola de Anthropic (costo del
// bot, key "Chatbot La Llosa 2") y las facturas de Twilio. El sync NO toca estos
// meses: escribe estos valores y marca "fijo (validado)". No llama a las APIs.
const MESES_FIJOS = {
  '2026-03': { railway: 5, twilio: 1.42,  claude: 0 },
  '2026-04': { railway: 5, twilio: 19.46, claude: 9.29 },
  '2026-05': { railway: 5, twilio: 20.35, claude: 66.95 },
};

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

/** ym ('YYYY-MM') del mes inmediatamente anterior. Maneja el cambio de año. */
function prevMonthYm(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
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
  // Sumamos el totalprice COMPLETO (incluye la renta del número, phonenumbers-local
  // ~$1.15). NOTA: el "Total monthly spend" de Usage Statements NO incluye esa renta,
  // por eso marzo se ve más alto que esa cifra; totalprice es el gasto real completo
  // y es lo correcto (abril/mayo cuadran con él). No excluir ninguna categoría.
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
  const byDescription = {};
  const byWsDesc = {};
  const statuses = [];
  let pages = 0, buckets = 0, results = 0;
  let page = null;
  const MAX_PAGES = 100; // tope de seguridad anti-loop

  // Pagina mientras has_more: cost_report devuelve buckets diarios y los parte en
  // páginas; leer solo la primera dejaba el mes corto (junio salía ~$19 vs ~$73).
  // group_by workspace_id + description para diagnosticar si hay más de una fuente
  // de costo (ej. la key del bot y otra key de desarrollo en el mismo workspace).
  do {
    const params = new URLSearchParams({ starting_at: startISO, ending_at: endISO });
    params.append('group_by[]', 'workspace_id');
    params.append('group_by[]', 'description');
    if (page) params.set('page', page);
    const url = `https://api.anthropic.com/v1/organizations/cost_report?${params.toString()}`;

    // El cost_report tiene un rate limit bajo; reintentar en 429 con backoff
    // (respeta Retry-After si viene). Necesario sobre todo al correr varios meses.
    const hdrs = { 'anthropic-version': '2023-06-01', 'x-api-key': key };
    let res;
    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch(url, { headers: hdrs });
      if (res.status !== 429) break;
      const ra = parseInt(res.headers.get('retry-after') || '', 10);
      const waitMs = Number.isFinite(ra) ? ra * 1000 : 3000 * Math.pow(2, attempt); // 3,6,12,24s
      if (attempt < 4) await new Promise(r => setTimeout(r, Math.min(waitMs, 20000)));
    }
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
        const ws   = result.workspace_id || 'sin-workspace';
        const desc = result.description || 'sin-descripcion';
        byWorkspace[ws] = (byWorkspace[ws] || 0) + amt;
        byDescription[desc] = (byDescription[desc] || 0) + amt;
        const k = `${ws} | ${desc}`;
        byWsDesc[k] = (byWsDesc[k] || 0) + amt;
      }
    }

    page = json.has_more ? json.next_page : null;
  } while (page && pages < MAX_PAGES);

  // La doc indica que los montos vienen en la unidad mínima (centavos): USD = suma/100.
  // Divisor configurable por si Anthropic cambiara el formato (default 100).
  const divisor = parseFloat(process.env.ANTHROPIC_COST_DIVISOR) || 100;
  const usd = rawTotal / divisor;
  const toUsd = (m) => Object.fromEntries(
    Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / divisor).toFixed(2)])
  );
  const debug = {
    rango: `${startISO} → ${endISO}`,
    statuses, pages, buckets, results,
    rawTotal, divisor, usd: +usd.toFixed(4),
    byWorkspaceUsd: toUsd(byWorkspace),
    byDescriptionUsd: toUsd(byDescription),
    byWorkspaceDescUsd: toUsd(byWsDesc),
  };
  console.log(`💵 Anthropic ${startISO.slice(0, 10)}→${endISO.slice(0, 10)}: pages=${pages} buckets=${buckets} results=${results} crudo=${rawTotal} → $${usd.toFixed(2)} USD`);
  Object.entries(byWorkspace).forEach(([ws, amt]) => {
    console.log(`   workspace ${ws}: crudo=${amt} → $${(amt / divisor).toFixed(2)} USD`);
  });
  return { usd, debug };
}

// ── Diagnóstico por API KEY (usage_report/messages) ───────────────────────────
// El cost_report NO filtra por api_key (solo workspace/description). El
// usage_report/messages SÍ agrupa por api_key_id y da tokens por tipo. Calculamos
// el costo por key multiplicando por tarifas. Sirve para aislar el costo del bot
// ("Chatbot La Llosa 2") del de otras keys en el mismo workspace Default.

// Tarifas por 1M de tokens (USD) por modelo. Cache: lectura 0.1x del input,
// escritura 5m 1.25x, escritura 1h 2x. (Sonnet 4.6: in 3 / out 15.)
const MODEL_RATES = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'claude-opus-4-8':   { in: 5, out: 25 },
  'claude-opus-4-7':   { in: 5, out: 25 },
  'claude-opus-4-6':   { in: 5, out: 25 },
  'claude-opus-4-5':   { in: 5, out: 25 },
  'claude-haiku-4-5':  { in: 1, out: 5 },
  'claude-fable-5':    { in: 10, out: 50 },
};
function rateFor(model) {
  if (model) for (const k of Object.keys(MODEL_RATES)) if (model.includes(k)) return MODEL_RATES[k];
  return { in: 3, out: 15 }; // default Sonnet
}
function extractTokens(r) {
  const cc = r.cache_creation || {};
  return {
    uncached_input: +r.uncached_input_tokens || 0,
    cache_write_5m: +(r.cache_creation_input_tokens != null ? r.cache_creation_input_tokens : (cc.ephemeral_5m_input_tokens || 0)) || 0,
    cache_write_1h: +(cc.ephemeral_1h_input_tokens || 0) || 0,
    cache_read:     +r.cache_read_input_tokens || 0,
    output:         +r.output_tokens || 0,
  };
}
function usdFromTokens(model, t) {
  const r = rateFor(model), M = 1e6;
  return (t.uncached_input * r.in
        + t.cache_write_5m * r.in * 1.25
        + t.cache_write_1h * r.in * 2
        + t.cache_read     * r.in * 0.1
        + t.output         * r.out) / M;
}

async function adminFetch(url) {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) throw new Error('ANTHROPIC_ADMIN_KEY no configurada');
  const hdrs = { 'anthropic-version': '2023-06-01', 'x-api-key': key };
  let res;
  for (let a = 0; a < 5; a++) {
    res = await fetch(url, { headers: hdrs });
    if (res.status !== 429) break;
    const ra = parseInt(res.headers.get('retry-after') || '', 10);
    if (a < 4) await new Promise(r => setTimeout(r, Math.min(Number.isFinite(ra) ? ra * 1000 : 3000 * 2 ** a, 20000)));
  }
  return res;
}

async function fetchApiKeys() {
  const out = {};
  let page = null, guard = 0;
  do {
    const p = new URLSearchParams({ limit: '100' });
    if (page) p.set('page', page);
    const res = await adminFetch(`https://api.anthropic.com/v1/organizations/api_keys?${p}`);
    if (!res.ok) throw new Error(`api_keys HTTP ${res.status}`);
    const j = await res.json();
    for (const k of (j.data || [])) out[k.id] = k.name;
    page = j.has_more ? j.next_page : null;
  } while (page && ++guard < 20);
  return out;
}

async function fetchUsageByKey(startISO, endISO) {
  const byKeyModel = {};
  const statuses = [];
  let page = null, pages = 0, buckets = 0, results = 0;
  do {
    const p = new URLSearchParams({ starting_at: startISO, ending_at: endISO, bucket_width: '1d', limit: '31' });
    p.append('group_by[]', 'api_key_id');
    p.append('group_by[]', 'model');
    if (page) p.set('page', page);
    const res = await adminFetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?${p}`);
    statuses.push(res.status);
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`usage_report HTTP ${res.status} ${t.slice(0, 200)}`); }
    const j = await res.json();
    pages++;
    for (const b of (j.data || [])) {
      buckets++;
      for (const r of (b.results || [])) {
        results++;
        const kid = r.api_key_id || 'sin-key';
        const model = r.model || 'sin-model';
        const mk = `${kid}||${model}`;
        const t = extractTokens(r);
        const acc = byKeyModel[mk] || (byKeyModel[mk] = { uncached_input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 0 });
        for (const f of Object.keys(t)) acc[f] += t[f];
      }
    }
    page = j.has_more ? j.next_page : null;
  } while (page && pages < 100);
  return { byKeyModel, meta: { statuses, pages, buckets, results } };
}

async function diagKeys(ym) {
  const [y, m] = ym.split('-').map(Number);
  const startISO = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const endISO   = new Date(Date.UTC(y, m, 1)).toISOString();

  let names = {}, namesError = null;
  try { names = await fetchApiKeys(); } catch (e) { namesError = e.message; }

  const { byKeyModel, meta } = await fetchUsageByKey(startISO, endISO);

  const perKey = {};
  for (const [mk, t] of Object.entries(byKeyModel)) {
    const [kid, model] = mk.split('||');
    const usd = usdFromTokens(model, t);
    if (!perKey[kid]) perKey[kid] = { api_key_id: kid, name: names[kid] || '(desconocido)', usd: 0, models: {}, tokens: { uncached_input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 0 } };
    perKey[kid].usd += usd;
    perKey[kid].models[model] = +((perKey[kid].models[model] || 0) + usd).toFixed(4);
    for (const f of Object.keys(t)) perKey[kid].tokens[f] += t[f];
  }
  const keys = Object.values(perKey).map(k => ({ ...k, usd: +k.usd.toFixed(2) })).sort((a, b) => b.usd - a.usd);
  const totalUsd = +keys.reduce((s, k) => s + k.usd, 0).toFixed(2);
  return { ym, rango: `${startISO} → ${endISO}`, totalUsd, botKeyId: process.env.BOT_API_KEY_ID || null, namesError, meta, keys };
}

// ── Escritura a "8 Costos" ────────────────────────────────────────────────────

/**
 * Escribe/actualiza la fila del mes. Conserva Otros (H) si la fila ya existía.
 * USD (railway/twilioUsd/claudeUsd): si llegan null, conserva el valor previo (no
 * lo pisa con 0). Conteos: claudeIn/claudeOut se escriben si vienen (tokens reales
 * del bot), o se conservan si null; twilioMsgs se escribe si se pasa (incl. ''),
 * o se conserva si no se pasa.
 */
async function upsertMonth(ym, { railway, twilioUsd, claudeUsd, claudeIn, claudeOut, twilioMsgs } = {}) {
  const sheets = getSheets();
  await ensureSheet(sheets);
  const rows = await readRows(sheets);

  const idx = rows.findIndex((r, i) => i > 0 && r[0] === ym);
  const ex  = idx > 0 ? rows[idx] : [];

  const otros = +ex[7] || 0;

  // null → conservar lo previo
  const railwayUsd = (railway   == null) ? (+ex[1] || 0) : +(+railway).toFixed(2);
  const twilioFin  = (twilioUsd == null) ? (+ex[3] || 0) : +(+twilioUsd).toFixed(4);
  const claudeFin  = (claudeUsd == null) ? (+ex[6] || 0) : +(+claudeUsd).toFixed(4);

  // Conteos C/E/F: escribir si viene valor; conservar lo previo si no.
  const cTwilioMsgs = (twilioMsgs !== undefined) ? twilioMsgs : (ex[2] !== undefined ? ex[2] : '');
  const cClaudeIn   = (claudeIn   != null)       ? claudeIn   : (ex[4] !== undefined ? ex[4] : '');
  const cClaudeOut  = (claudeOut  != null)       ? claudeOut  : (ex[5] !== undefined ? ex[5] : '');

  const total = railwayUsd + twilioFin + claudeFin + RATES.sheetsMonthly + otros;

  const out = [
    ym,                       // A
    railwayUsd,               // B
    cTwilioMsgs,              // C (Twilio msgs)
    twilioFin,                // D
    cClaudeIn,                // E (Claude tok in — reales del bot)
    cClaudeOut,               // F (Claude tok out)
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

// ── Claude del BOT (usage_report filtrado por su api_key) ─────────────────────
// El cost_report del workspace mezcla las 3 keys (bot + Admin + Claude Code). Para
// el costo SOLO del bot, usamos usage_report/messages filtrado por BOT_API_KEY_ID
// y multiplicamos los tokens por las tarifas de su modelo.
async function fetchBotClaudeMonth(startISO, endISO) {
  if (!process.env.ANTHROPIC_ADMIN_KEY) return { usd: null, status: 'no-admin-key' };
  const botKey = process.env.BOT_API_KEY_ID;
  if (!botKey) return { usd: null, status: 'no-BOT_API_KEY_ID' };

  const byModel = {};
  const statuses = [];
  let page = null, pages = 0, results = 0;
  do {
    const p = new URLSearchParams({ starting_at: startISO, ending_at: endISO, bucket_width: '1d', limit: '31' });
    p.append('api_key_ids[]', botKey);
    p.append('group_by[]', 'model');
    if (page) p.set('page', page);
    const res = await adminFetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?${p}`);
    statuses.push(res.status);
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`usage_report HTTP ${res.status} ${t.slice(0, 200)}`); }
    const j = await res.json();
    pages++;
    for (const b of (j.data || [])) for (const r of (b.results || [])) {
      results++;
      const model = r.model || 'sin-model';
      const t = extractTokens(r);
      const acc = byModel[model] || (byModel[model] = { uncached_input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 0 });
      for (const f of Object.keys(t)) acc[f] += t[f];
    }
    page = j.has_more ? j.next_page : null;
  } while (page && pages < 100);

  let usd = 0, tokIn = 0, tokOut = 0;
  const byModelUsd = {};
  for (const [model, t] of Object.entries(byModel)) {
    const u = usdFromTokens(model, t); usd += u; byModelUsd[model] = +u.toFixed(4);
    tokIn  += t.uncached_input + t.cache_write_5m + t.cache_write_1h + t.cache_read;
    tokOut += t.output;
  }
  console.log(`💵 Bot Claude ${startISO.slice(0, 10)}→${endISO.slice(0, 10)}: $${usd.toFixed(2)} USD | in=${tokIn} out=${tokOut} (${JSON.stringify(byModelUsd)})`);
  return { usd: +usd.toFixed(4), status: 'ok', tokIn, tokOut, byModelUsd, statuses, pages, results };
}

// Escribe un mes FIJO (validado) en "8 Costos". Conserva Otros (H); deja los
// conteos C/E/F en blanco (no tenemos el desglose de los meses fijos y no importa).
// total = railway + twilio + claude + otros; marca "Actualizado" = fijo.
async function writeFixedMonth(ym, vals) {
  const sheets = getSheets();
  await ensureSheet(sheets);
  const rows = await readRows(sheets);
  const idx = rows.findIndex((r, i) => i > 0 && r[0] === ym);
  const ex  = idx > 0 ? rows[idx] : [];

  const otros = +ex[7] || 0;

  const railway = +(+vals.railway).toFixed(2);
  const twilio  = +(+vals.twilio).toFixed(4);
  const claude  = +(+vals.claude).toFixed(4);
  const total   = +(railway + twilio + claude + otros).toFixed(2);

  // C/E/F en blanco para meses fijos.
  const out = [ym, railway, '', twilio, '', '', claude, otros, total, 'fijo (validado)'];

  if (idx > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `${SHEET}!A${idx + 1}:J${idx + 1}`,
      valueInputOption: 'USER_ENTERED', resource: { values: [out] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: `${SHEET}!A:J`,
      valueInputOption: 'USER_ENTERED', resource: { values: [out] },
    });
  }
  return { ym, railway, twilioUsd: twilio, claudeUsd: claude, total, fixed: true };
}

// ── Orquestación ──────────────────────────────────────────────────────────────

async function syncAll(monthsBack = 6, opts = {}) {
  const debug = !!opts.debug;
  const ranges = monthRanges(monthsBack);
  const currentYm = ranges[ranges.length - 1].ym; // último = mes en curso

  // Ventana móvil de 2 meses: mes en curso + mes anterior. El usage_report de
  // Anthropic trae ~1 día de retraso, así que el mes recién cerrado debe seguir
  // refrescándose unos días para captar sus últimos días y quedar completo.
  // Como Claude se mide filtrado por BOT_API_KEY_ID (solo el bot), re-sincronizar
  // el mes anterior es seguro y no re-infla nada.
  const ventana = new Set([currentYm, prevMonthYm(currentYm)]);

  // Meses en paralelo: cada escritura toca su propia fila (rango distinto).
  const summary = await Promise.all(ranges.map(async (m) => {
    try {
      // 1) Meses fijos validados → escribir valores fijos, SIN llamar a las APIs.
      if (MESES_FIJOS[m.ym]) {
        const res = await writeFixedMonth(m.ym, MESES_FIJOS[m.ym]);
        console.log(`📌 fijo ${m.ym}: Railway $${res.railway} | Twilio $${res.twilioUsd} | Claude $${res.claudeUsd} | Total $${res.total}`);
        return { ...res, twilioStatus: 'fijo', claudeStatus: 'fijo' };
      }

      // 2) Solo los meses dentro de la ventana (en curso + anterior) se sincronizan.
      //    Meses más viejos que la ventana (y no fijos) no se re-sobrescriben.
      if (!ventana.has(m.ym)) {
        return { ym: m.ym, skipped: 'fuera-de-ventana' };
      }

      // 3) Mes en ventana: Twilio real + Claude SOLO del bot (usage_report por key).
      const startDate = m.startISO.slice(0, 10);
      const endDate = new Date(m.end.getTime() - 86400000).toISOString().slice(0, 10);

      let twilioUsd = null, twilioStatus = 'ok', twilioDebug = null;
      try {
        const tw = await fetchTwilioMonth(startDate, endDate, debug);
        twilioUsd = tw.usd; twilioDebug = tw.debug;
      }
      catch (e) { twilioStatus = `error: ${e.message}`; console.error(`Twilio ${m.ym} error: ${e.message}`); }

      let claudeUsd = null, claudeIn = null, claudeOut = null, claudeStatus = 'ok', claudeDebug = null;
      try {
        const cr = await fetchBotClaudeMonth(m.startISO, m.endISO);
        claudeUsd = cr.usd; claudeIn = cr.tokIn ?? null; claudeOut = cr.tokOut ?? null;
        claudeStatus = cr.status; claudeDebug = cr;
      }
      catch (e) { claudeStatus = `error: ${e.message}`; console.error(`Anthropic ${m.ym} error: ${e.message}`); }

      const res = await upsertMonth(m.ym, {
        railway: RATES.railwayMonthly, twilioUsd, claudeUsd,
        claudeIn, claudeOut,
        twilioMsgs: '', // Twilio msgs: no se mide de forma confiable sin llamada extra → en blanco
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
  // COST_SYNC_ON_BOOT (default true): corre un sync ~30s tras arrancar. Si es
  // 'false', solo deja el intervalo de 6h (útil para no gastar rate limit en cada deploy).
  const onBoot = process.env.COST_SYNC_ON_BOOT !== 'false';
  if (onBoot) {
    setTimeout(() => {
      syncAll().catch(e => console.error('costSync inicial error:', e.message));
    }, 30 * 1000);
  }
  // luego cada 6 horas
  setInterval(() => {
    syncAll().catch(e => console.error('costSync periódico error:', e.message));
  }, 6 * 60 * 60 * 1000);
  console.log(`🔄 costSync iniciado — ${onBoot ? 'sync ~30s tras boot y ' : '(boot sync OFF) '}cada 6h`);
}

module.exports = {
  monthRanges,
  fetchTwilioMonth,
  fetchAnthropicMonth,
  upsertMonth,
  syncAll,
  start,
  fetchApiKeys,
  fetchUsageByKey,
  diagKeys,
};
