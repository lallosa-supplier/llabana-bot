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

// WhatsApp/Twilio rechaza cuerpos > 1600 chars (error 21617) → el cliente no recibe nada.
// Troceamos a 1500 con margen. Corte en frontera natural (doble salto > salto > espacio),
// sin partir palabras; corte duro solo si no hay frontera razonable.
const WHATSAPP_LIMIT = 1500;

function trocearMensaje(texto, max = WHATSAPP_LIMIT) {
  if (typeof texto !== 'string' || texto.length <= max) return [texto];
  const partes = [];
  let resto = texto;
  while (resto.length > max) {
    const ventana = resto.slice(0, max);
    let corte = ventana.lastIndexOf('\n\n');
    if (corte < max * 0.5) corte = ventana.lastIndexOf('\n');
    if (corte < max * 0.5) corte = ventana.lastIndexOf(' ');
    if (corte < max * 0.5) corte = max; // sin frontera: corte duro
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes.filter(Boolean);
}

/**
 * Envía un mensaje de WhatsApp vía Twilio. Si el cuerpo (ya sanitizado) excede el
 * límite de WhatsApp, lo parte en varias partes y las manda en orden.
 * @param {string} to  - Número destino en formato whatsapp:+521234567890
 * @param {string} body - Cuerpo del mensaje
 */
async function sendMessage(to, body) {
  const texto  = sanitizarWhatsApp(body);
  const partes = trocearMensaje(texto);

  // Caso normal (una parte): mismo contrato de antes — envía y propaga error si falla.
  if (partes.length <= 1) {
    return withTimeout(
      client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to,
        body: texto,
      }),
      30000,
      'Twilio sendMessage'
    );
  }

  // Mensaje largo: enviar las partes EN ORDEN. Best-effort: un fallo en una parte se
  // loguea y NO revienta el flujo (las partes anteriores ya salieron).
  console.log(`✂️ mensaje partido en ${partes.length} partes (${texto.length} chars) para ${to}`);
  let ultimo = null;
  for (let i = 0; i < partes.length; i++) {
    try {
      ultimo = await withTimeout(
        client.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to,
          body: partes[i],
        }),
        30000,
        'Twilio sendMessage'
      );
    } catch (err) {
      console.error(`❌ Error enviando parte ${i + 1}/${partes.length} a ${to}: ${err.message}`);
    }
  }
  return ultimo;
}

module.exports = { sendMessage, sanitizarWhatsApp, trocearMensaje };
