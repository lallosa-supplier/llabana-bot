const twilio = require('twilio');

console.log('📱 Twilio FROM number:', process.env.TWILIO_WHATSAPP_NUMBER);

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Convierte la negrita de markdown (**texto** o ***texto***) a la de WhatsApp
 * (*texto*). WhatsApp solo entiende UN asterisco para negrita; si llegan dobles
 * los muestra literales. Determinista: colapsa cualquier corrida de 2+ asteriscos
 * a uno solo. NO toca el asterisco sencillo ya correcto, ni listas/saltos/otro formato.
 * @param {string} texto
 * @returns {string}
 */
function sanitizarWhatsApp(texto) {
  if (typeof texto !== 'string') return texto;
  return texto.replace(/\*{2,}/g, '*');
}

// Acota cualquier promesa a `ms`: si Twilio se cuelga, rechaza y libera el flujo (y el
// lock del webhook) en vez de esperar para siempre. La request de fondo puede seguir,
// pero el caller ya no queda colgado.
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timeout tras ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/**
 * Envía un mensaje de WhatsApp vía Twilio.
 * @param {string} to  - Número destino en formato whatsapp:+521234567890
 * @param {string} body - Cuerpo del mensaje
 */
async function sendMessage(to, body) {
  const msg = await withTimeout(
    client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to,
      body: sanitizarWhatsApp(body),
    }),
    30000,
    'Twilio sendMessage'
  );
  return msg;
}

module.exports = { sendMessage, sanitizarWhatsApp };
