/**
 * Logger centralizado — consistencia en todos los logs
 */

const logger = {
  info: (tag, message) => {
    console.log(`ℹ️  [${tag}]`, message);
  },

  warn: (tag, message) => {
    console.warn(`⚠️  [${tag}]`, message);
  },

  error: (tag, message, err = null) => {
    if (err && err.message) {
      console.error(`❌ [${tag}]`, message, `(${err.message})`);
    } else {
      console.error(`❌ [${tag}]`, message);
    }
  },

  success: (tag, message) => {
    console.log(`✅ [${tag}]`, message);
  },

  debug: (tag, message) => {
    if (process.env.DEBUG) {
      console.log(`🔍 [${tag}]`, message);
    }
  },

  // Para logs de flujo conversacional
  message: (from, content, direction = 'in') => {
    const arrow = direction === 'in' ? '📨' : '📤';
    console.log(`${arrow} [${from}]: ${content.substring(0, 100)}${content.length > 100 ? '…' : ''}`);
  },
};

module.exports = logger;
