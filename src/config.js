/**
 * Central Configuration — Environment and runtime settings
 * Single source of truth for all non-secret configuration
 */

module.exports = {
  // Google Sheets structure
  SHEETS: {
    ID: process.env.GOOGLE_SHEETS_ID,
    TABS: {
      MAESTRO: 'Base Maestra',
      SUCURSALES: 'Sucursales',
      RUTAS: 'Rutas Reparto',
      SEGUIMIENTOS: 'Seguimientos 24h',
      TRANSCRIPCIONES: 'Transcripciones',
      FAQ: 'FAQs',
      PRODUCTOS: 'Productos',
    },
    HEADERS: {
      MAESTRO: [
        'Timestamp',
        'Teléfono',
        'Nombre',
        'Ciudad',
        'CP',
        'Segmento',
        'Tags',
        'Última Interacción',
      ],
    },
    CACHE_TTL: 5 * 60 * 1000, // 5 minutes
  },

  // Business logic timing
  BUSINESS_HOURS: {
    WEEKDAY_START: 8, // 8am
    WEEKDAY_END: 17, // 5pm
    SATURDAY_START: 9, // 9am
    SATURDAY_END: 14, // 2pm
    TIMEZONE: 'America/Mexico_City',
  },

  // Session and storage
  SESSION: {
    TTL_HOURS: 30,
    TTL_SECONDS: 30 * 60 * 60,
    FALLBACK_MEMORY: true,
  },

  // Rate limiting
  RATE_LIMIT: {
    WEBHOOK_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    WEBHOOK_MAX_REQUESTS: 1000,
    DEBOUNCE_MS: 1500, // 1.5 seconds
  },

  // Follow-up service timing
  FOLLOWUP: {
    TYPE_A_DELAY_MS: 2 * 60 * 60 * 1000, // 2 hours
    TYPE_A_CUTOFF_HOUR: 19, // Don't send after 7pm
    TYPE_C_DELAY_MS: 23 * 60 * 60 * 1000, // 23 hours
    TYPE_C_RENOTIFY_INTERVAL: 2 * 60 * 60 * 1000, // 2 hours
  },

  // Zone/Delivery
  ZONES: {
    CDMX_RANGE: { min: 1000, max: 16999 },
    EDOMEX_RANGE: { min: 50000, max: 57999 },
    PAQUETERIA_THRESHOLD: 10, // Max bultos for paquetería
    TRUCK_THRESHOLD: 500, // Min bultos for truck quote
    TRUCK_WEIGHT_THRESHOLD: 12, // Toneladas
  },

  // Twilio
  TWILIO: {
    BOT_NUMBER: '+17623490579',
    WIG_NUMBER: process.env.WIG_WHATSAPP_NUMBER,
  },

  // Claude AI
  CLAUDE: {
    MODEL: 'claude-sonnet-4-6',
    MAX_TOKENS: 1024,
    TEMPERATURE: 0.3,
  },

  // Redis
  REDIS: {
    HOST: process.env.REDIS_HOST || 'localhost',
    PORT: process.env.REDIS_PORT || 6379,
    DB: process.env.REDIS_DB || 0,
    RECONNECT_DELAY_MS: 5000,
  },

  // Feature flags
  FEATURES: {
    REDIS_ENABLED: !!process.env.REDIS_HOST,
    REDIS_FALLBACK_ENABLED: true,
    SHOPIFY_WEBHOOKS_ENABLED: !!process.env.SHOPIFY_WEBHOOK_SECRET,
    TRANSCRIPT_LOGGING_ENABLED: true,
  },

  // Logging
  LOGGING: {
    LEVEL: process.env.LOG_LEVEL || 'info',
    INCLUDE_TIMESTAMPS: true,
    INCLUDE_EMOJI: true,
  },

  // API Timeouts
  TIMEOUTS: {
    SHEETS_API_MS: 10000,
    CLAUDE_API_MS: 30000,
    TWILIO_SEND_MS: 10000,
    REDIS_OPERATION_MS: 5000,
  },
};
