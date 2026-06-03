/**
 * Sheet Schemas — Centralized definitions of Google Sheets data structures
 * Prevents magic column indices and makes sheet changes traceable
 */

/**
 * Base Maestra (Master customer database)
 */
const MAESTRO_SCHEMA = {
  tabs: 'Base Maestra',
  columns: {
    TIMESTAMP: 0,
    PHONE: 1,
    NAME: 2,
    CITY: 3,
    CP: 4,
    SEGMENT: 5, // Comprador, Distribuidor, Proveedor, Corporativo
    TAGS: 6, // Commas-separated: Reparto, No Contestó, etc
    LAST_INTERACTION: 7,
  },
  headerRow: 1,
  startRow: 2,
};

/**
 * Sucursales (Branch locations)
 */
const SUCURSALES_SCHEMA = {
  tabs: 'Sucursales',
  columns: {
    NAME: 0,
    CITY: 1,
    STATE: 2,
    PHONE: 3,
    ADDRESS: 4,
    CP: 5,
    DELIVERY_ZONE: 6,
  },
  headerRow: 1,
  startRow: 2,
};

/**
 * Rutas Reparto (Delivery routes)
 */
const RUTAS_SCHEMA = {
  tabs: 'Rutas Reparto',
  columns: {
    ROUTE_ID: 0,
    DESCRIPTION: 1,
    COVERAGE_CP_RANGE: 2,
    STATE: 3,
    FREQUENCY: 4,
    COST: 5,
  },
  headerRow: 1,
  startRow: 2,
};

/**
 * Seguimientos 24h (24-hour follow-ups)
 */
const SEGUIMIENTOS_SCHEMA = {
  tabs: 'Seguimientos 24h',
  columns: {
    TIMESTAMP: 0,
    PHONE: 1,
    CUSTOMER_NAME: 2,
    FOLLOWUP_TYPE: 3, // A, B, C
    STATUS: 4, // pending, sent, responded, failed
    MESSAGE: 5,
  },
  headerRow: 1,
  startRow: 2,
};

/**
 * Transcripciones (Conversation transcripts)
 */
const TRANSCRIPCIONES_SCHEMA = {
  tabs: 'Transcripciones',
  columns: {
    TIMESTAMP: 0,
    PHONE: 1,
    CUSTOMER_NAME: 2,
    TRANSCRIPT: 3, // Raw conversation (48k char limit)
    RESOLUTION: 4, // closed, escalated, waiting
    DURATION_MINUTES: 5,
  },
  headerRow: 1,
  startRow: 2,
};

/**
 * Productos (Product catalog)
 */
const PRODUCTOS_SCHEMA = {
  tabs: 'Productos',
  columns: {
    SKU: 0,
    NAME: 1,
    BRAND: 2,
    CATEGORY: 3,
    PRICE: 4,
    STOCK_STATUS: 5, // in_stock, out_of_stock, low_stock
    SHOPIFY_URL: 6,
    NOTES: 7,
  },
  headerRow: 1,
  startRow: 2,
};

/**
 * FAQs (Knowledge base)
 */
const FAQ_SCHEMA = {
  tabs: 'FAQs',
  columns: {
    CATEGORY: 0,
    QUESTION: 1,
    ANSWER: 2,
    KEYWORDS: 3,
  },
  headerRow: 1,
  startRow: 2,
};

/**
 * Helper to get column index from schema
 * @param {object} schema - One of the schemas above
 * @param {string} columnName - Column name (e.g., 'PHONE')
 * @returns {number} - Column index (0-based)
 */
function getColumnIndex(schema, columnName) {
  return schema.columns[columnName];
}

/**
 * Helper to build a row from an object
 * @param {object} schema
 * @param {object} data - Data with keys matching schema column names
 * @returns {array} - Array of values in correct column order
 */
function buildRow(schema, data) {
  const row = new Array(Object.keys(schema.columns).length).fill('');
  Object.entries(data).forEach(([key, value]) => {
    const index = schema.columns[key];
    if (index !== undefined) {
      row[index] = value || '';
    }
  });
  return row;
}

module.exports = {
  MAESTRO_SCHEMA,
  SUCURSALES_SCHEMA,
  RUTAS_SCHEMA,
  SEGUIMIENTOS_SCHEMA,
  TRANSCRIPCIONES_SCHEMA,
  PRODUCTOS_SCHEMA,
  FAQ_SCHEMA,
  getColumnIndex,
  buildRow,
};
