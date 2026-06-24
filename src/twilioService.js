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

/**
 * Envía un mensaje de WhatsApp vía Twilio.
 * @param {string} to  - Número destino en formato whatsapp:+521234567890
 * @param {string} body - Cuerpo del mensaje
 */
async function sendMessage(to, body) {
  const msg = await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: sanitizarWhatsApp(body),
  });
  return msg;
}

module.exports = { sendMessage, sanitizarWhatsApp };
