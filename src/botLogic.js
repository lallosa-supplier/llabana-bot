/**
 * Lógica central del bot de Llabana — flujo conversacional natural.
 *
 * Estados:
 *   asking_mexico    → filtro inicial único
 *   active           → conversación libre con Claude
 *   waiting_for_wig  → escalado a asesor
 *   escalated        → post-escalación
 *   confirming_reset → confirmación de reinicio
 *
 * Nombre y CP se capturan naturalmente dentro de la conversación activa.
 */

const sessionManager    = require('./sessionManager');
const sheetsService     = require('./sheetsService');
const claudeService     = require('./claudeService');
const twilioService     = require('./twilioService');
const horarioService    = require('./horarioService');
const colaEscalaciones  = require('./colaEscalaciones');
const { FLOW_STATES, TIME_CONSTANTS } = require('./constants');
const { CPValidator, PhoneValidator } = require('./validators');
const PatternRegistry   = require('./patternRegistry');
const { messageUtils, getFirstName } = require('./messageUtils');
const EscalationManager = require('./escalationManager');
const SessionUpdaters   = require('./sessionUpdaters');
const logger = require('./logger');

// ── Constantes ────────────────────────────────────────────────────────────────

const OUT_OF_COVERAGE_MSG =
  'Gracias por escribirnos 🙏 Por ahora solo tenemos entregas en México. ' +
  'Cuando estés por acá con gusto te ayudamos 🌾';

// ── Variedad en mensajes ──────────────────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const WELCOME_VARIANTS = [
  '¡Hola! 👋 Soy el asistente de Llabana, tu aliado en alimento balanceado 🌾 ¿Estás en México?',
  '¡Bienvenido! 🌾 Soy el asistente de Llabana. ¿Nos escribes desde México?',
  '¡Hola! 👋 Llabana, alimento balanceado para tus animales 🌾 ¿Estás en México?',
];

const CHANNEL_VARIANTS = [
  n => `¡Listo${n ? `, ${n}` : ''}! Puedes hacer tu pedido en llabanaenlinea.com y te lo mandamos a todo México 📦`,
  _n => 'Te mandamos por paquetería a todo México 📦 Haz tu pedido en llabanaenlinea.com',
  n => `Perfecto${n ? `, ${n}` : ''}. Entra a llabanaenlinea.com y pide desde ahí, llegamos a todo México 📦`,
];

const CLOSING_VARIANTS = [
  '¿Tienes alguna duda más? 😊',
  '¿Hay algo más en lo que te pueda ayudar?',
  '¿Se te ofrece algo más? 🌾',
];

// ── Patrones de detección ─────────────────────────────────────────────────────

const OUTSIDE_MEXICO_PATTERNS = [
  /estados\s*unidos/i, /\busa\b/i,       /\bee\.?\s*uu\.?\b/i,
  /\bguatemala\b/i,    /\bcolombia\b/i,  /\bvenezuela\b/i,
  /\bargentina\b/i,    /espa[ñn]a/i,     /canad[aá]/i,
  /\bchile\b/i,        /per[uú]/i,       /\bcuba\b/i,
  /\bhonduras\b/i,     /el\s*salvador/i, /\bnicaragua\b/i,
  /costa\s*rica/i,     /panam[aá]/i,     /\bbrasil\b/i,
  /\bbolivia\b/i,      /\becuador\b/i,   /\buruguay\b/i,
];

const ESCALATION_PROFILE_PATTERNS = [
  /distribuidor/i,
  /revendedor/i,
  /grandes?\s*cantidades?\s+(?:de\s+)?(?:tons?|toneladas?|cami[oó]n)/i,
];

const HUMAN_REQUEST_PATTERNS = [
  /\basesor\b/i, /\bhumano\b/i, /\bpersona\b/i, /\bwig\b/i,
  /\bagente\b/i, /hablar\s+con/i, /quiero\s+hablar/i,
  /\batenci[oó]n\s+humana\b/i, /\bme\s+atiendan?\b/i,
];

const PRICE_PATTERNS = [
  /\bprecio/i, /\bcu[aá]nto\s+cuesta/i, /\bcu[aá]nto\s+vale/i,
  /\bcu[aá]nto\s+cobran/i, /\bcu[aá]nto\s+es\b/i, /\bcosto\b/i,
  /\btarifa\b/i, /\bpresupuesto\b/i,
];

const RESET_PATTERNS = /^(inicio|men[uú]|empezar|reset|start|comenzar|nueva\s*consulta|reiniciar)$/i;

const RH_PATTERNS = [
  /\bvacante/i, /\bempleo\b/i, /\btrabajo\b/i, /\bcontrataci[oó]n/i,
  /\brecursos\s*humanos/i, /\brh\b/i, /\bpostularme\b/i, /\bpostulaci[oó]n/i,
  /\bcurr[ií]culum\b/i, /\bcv\b/i, /\bsueldo\b/i, /\bplaza\b/i,
  /\bmonitorista\b/i, /\bencargado\b/i, /me\s+interesa\s+(la\s+)?plaza/i,
  /busco\s+(trabajo|empleo)/i, /quiero\s+trabajar/i,
];

function isRHRequest(text) {
  return RH_PATTERNS.some(re => re.test(text));
}

const DESPEDIDA_PATTERNS = /^(gracias|muchas gracias|seria todo|sería todo|ok gracias|vale gracias|listo gracias|perfecto gracias|hasta luego|bye|adios|adiós|no gracias|es todo|eso es todo|por ahora es todo|nada mas|nada más)$/i;

const ENTRY_POINT_MAP = {
  'quiero mas informacion':               'Llabana.com Footer',
  'me podrian dar mas informacion':       'Llabana.com Header',
  'quiero mas informes':                  'Llabana.com Chatbot',
  'vi un producto que me interesa':       'Llabana.com Producto',
  'vi un producto en su tienda en linea': 'llabanaenlinea.com Producto',
  'me mandaron aqui desde la tienda':     'llabanaenlinea.com Chatbot',
  'los vi en facebook':                   'Facebook',
};

// ── Helpers de detección ──────────────────────────────────────────────────────

function detectarOrigen(message) {
  const lower = (message || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [key, value] of Object.entries(ENTRY_POINT_MAP)) {
    const keyNorm = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (lower.includes(keyNorm)) {
      console.log(`🔗 detectarOrigen: "${lower.substring(0, 50)}" → ${value}`);
      return value;
    }
  }
  console.log(`🔗 detectarOrigen: "${lower.substring(0, 50)}" → Directo`);
  return 'Directo';
}

function isOutsideMexico(text) {
  return /^no$/i.test(text.trim()) || PatternRegistry.test('OUTSIDE_MEXICO', text);
}

function isEscalationProfile(text) {
  // Excluir preguntas de cobertura ("¿tienen distribuidor en X?"): son clientes
  // buscando dónde comprar, no perfiles de mayoreo. Misma guarda que isDistribuidor.
  const esPreguntaCobertura =
    /tienen?\s+(alg[uú]n?\s+)?(distribuidor|tienda|sucursal|punto\s+de\s+venta)\s+(en|cerca|por)/i.test(text) ||
    /hay\s+(alg[uú]n?\s+)?(distribuidor|tienda|sucursal)\s+(en|cerca|por)/i.test(text) ||
    /d[oó]nde\s+(tienen?|hay|est[aá]n?)\s+(distribuidor|tienda|sucursal)/i.test(text);
  if (esPreguntaCobertura) return false;
  return PatternRegistry.test('ESCALATION_PROFILE', text.trim());
}

const DISTRIBUIDOR_PATTERNS = [
  /\bdistribui[dr]/i, /\bser\s+distribuidor/i, /\bvender\s+sus\s+productos/i,
  /\bfranquicia/i, /\brevendedor/i, /\bpunto\s+de\s+venta\s+propio/i,
  /\bquiero\s+vender\b/i, /\bcomercializar/i, /\bdistribución\s+exclusiva/i,
  /\bagente\s+de\s+ventas/i, /\bconvertirme\s+en\s+distribuidor/i,
  /\bveterinaria\b/i,
  /\bprecio(s)?\s+(para|de)\s+(veterinaria|tienda|negocio|reventa)/i,
  /\bventa\s+en\s+(veterinaria|tienda|negocio)/i,
  /\bpara\s+vender\b/i,
  /\brevender\b/i,
  /\bpunto\s+de\s+venta\b/i,
];

function isDistribuidor(text) {
  // Excluir preguntas sobre si hay distribuidor/tienda en una ciudad
  const esPreguntaCobertura = /tienen?\s+(alg[uú]n?\s+)?(distribuidor|tienda|sucursal|punto\s+de\s+venta)\s+(en|cerca|por)/i.test(text) ||
    /hay\s+(alg[uú]n?\s+)?(distribuidor|tienda|sucursal)\s+(en|cerca|por)/i.test(text) ||
    /d[oó]nde\s+(tienen?|hay|est[aá]n?)\s+(distribuidor|tienda|sucursal)/i.test(text);

  if (esPreguntaCobertura) return false;
  return PatternRegistry.test('DISTRIBUIDOR', text);
}

const PROVEEDOR_PATTERNS = [
  /\bser\s+proveedor/i,
  /\bquiero\s+proveer/i,
  /\bsoy\s+proveedor/i,
  /\bvenderle[s]?\s+(a\s+)?(llabana|ustedes)/i,
  /\bofrecer(les?)?\s+(mis\s+)?(productos?|servicios?|insumos?|materia)/i,
  /\bproveedor\s+de\s+llabana/i,
  /\bcontacto\s+de\s+compras/i,
  /\bdepartamento\s+de\s+compras/i,
  /\bquiero\s+venderles/i,
  /\bsoy\s+fabricante/i,
  /\bproducimos?\b/i,
  /\bimportador\b/i,
  /\bexportador\b/i,
  /\bmanufacturer\b/i,
  /\bsupplier\b/i,
  /\bfabricante\b/i,
  /\bwe\s+(are|make|produce|manufacture|supply)/i,
  /\bresponsable\s+de\s+compras/i,
  /\bpurchasing\s+(manager|department|contact)/i,
  /\bcooperation\b/i,
  /\bpartnership\b/i,
  /\bbusiness\s+opportunity/i,
];

function isProveedor(text) {
  return PatternRegistry.test('PROVEEDOR', text);
}

function isRequestingHuman(text) {
  return PatternRegistry.test('HUMAN_REQUEST', text.trim());
}

function isPriceQuestion(text) {
  return PatternRegistry.test('PRICE_QUESTION', text.trim());
}

// ── Helpers de CP ─────────────────────────────────────────────────────────────

/** CP 01000–16999 → CDMX */
function cpIsCDMX(cp) {
  const n = parseInt(cp, 10);
  return n >= 1000 && n <= 16999;
}

/** CP 50000–57999 (prefijo 50–57) → Estado de México */
function cpIsEdomex(cp) {
  const s = cp.toString().padStart(5, '0');
  const prefix = parseInt(s.substring(0, 2), 10);
  return prefix >= 50 && prefix <= 57;
}

/** Deriva el nombre del estado a partir del CP. */
function cpToState(cp) {
  if (cpIsCDMX(cp))   return 'Ciudad de México';
  if (cpIsEdomex(cp)) return 'Estado de México';
  return '';
}

// ── Helpers de texto ──────────────────────────────────────────────────────────

function capitalize(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function primerNombre(nombre) {
  return getFirstName(nombre);
}

/** Recorta conversationHistory a los últimos N mensajes (par user/assistant) */
function trimHistory(history, max = 20) {
  if (!Array.isArray(history) || history.length <= max) return history;
  return history.slice(-max);
}

// ── Punto de entrada ──────────────────────────────────────────────────────────

async function handleMessage(phone, messageBody) {
  // Cerebro IA atiende a todos los clientes
  return require('./aiBot').handleMessageIA(phone, messageBody);
}

async function handleMediaMessage(phone, mediaType = '') {
  const session = await sessionManager.getSession(phone);
  const nombre = session?.customer?.name ? ` ${primerNombre(session.customer.name)}` : '';

  const esPDF = /pdf|document/i.test(mediaType);
  if (esPDF) {
    return `No puedo abrir archivos PDF${nombre} 😅 ¿Me puedes escribir la lista de productos que necesitas? Con gusto te ayudo a cotizar todo 📋`;
  }

  if (session?.flowState === 'active' || session?.flowState === 'waiting_for_wig') {
    return `Vi que mandaste una imagen${nombre} 😊 Por el momento no puedo verla, pero cuéntame — ¿qué producto o tema te interesa? Con gusto te ayudo 🌾`;
  }

  if (session) {
    return '😊 Recibí tu imagen pero no puedo verla. ¿Me puedes decir con texto qué producto buscas o en qué te puedo ayudar?';
  }

  return '¡Hola! 👋 Soy el asistente de Llabana, tu aliado en alimento balanceado 🌾\nRecibí tu imagen pero no puedo verla 😅 ¿Me cuentas qué producto te interesa o en qué te puedo ayudar? ¿Estás en México?';
}

// ── Confirmar nombre ──────────────────────────────────────────────────────────

async function handleConfirmingName(phone, message, session) {
  const msg = message.trim().toLowerCase();

  // Confirmación positiva
  const esConfirmacion = /^(s[ií]|sí|si|correcto|exact|ok|okay|claro|así|eso|👍|afirma)/.test(msg) ||
                         /^(su|sus|en\s+efecto)$/.test(msg);

  // Corrección — el cliente da un nombre diferente
  const nombreNuevo = sheetsService.limpiarNombre(message);

  if (esConfirmacion || (!nombreNuevo && !esConfirmacion)) {
    // Confirmó o no dijo nada reconocible — usar el nombre pendiente
    const nombre = session.tempData?.namePendiente || '';
    const first  = primerNombre(nombre);

    if (session.customer?.rowIndex) {
      sheetsService.updateOrderData(session.customer.rowIndex, { name: nombre }).catch(err => console.error('[botLogic] Sheets/Redis error:', err.message));
    }
    await sessionManager.updateSession(phone, {
      flowState: 'active',
      tempData:  { ...session.tempData, name: nombre, namePendiente: undefined },
      customer:  { ...session.customer, name: nombre },
    });

    // Ejecutar escalación pendiente si la hay
    if (session.tempData?.escalacionPendienteZonaLocal ||
        session.tempData?.escalacionPendienteMayoreo ||
        session.tempData?.escalacionPendienteHumano) {
      const motivo = session.tempData?.motivoEscalacion || 'Cliente solicitó asesor';
      await notifyWig(phone, { ...session, tempData: { ...session.tempData, name: nombre } }, motivo);
      await sessionManager.updateSession(phone, {
        flowState: 'waiting_for_wig',
        tempData: {
          ...session.tempData,
          name: nombre,
          escalacionPendienteZonaLocal: undefined,
          escalacionPendienteMayoreo: undefined,
          escalacionPendienteHumano: undefined,
          motivoEscalacion: undefined,
        },
      });
      return `¡Mucho gusto, ${first}! 😊 Un asesor te contactará en breve por este WhatsApp 🙌`;
    }

    const intentPrevio = session.tempData?.intentPrevio;
    if (intentPrevio) {
      await sessionManager.updateSession(phone, {
        tempData: { ...session.tempData, intentPrevio: undefined, namePendiente: undefined },
      });
      const updatedSession = await sessionManager.getSession(phone);
      const respuesta = await clasificarIntencion(phone, intentPrevio, updatedSession);
      return `¡Mucho gusto, ${first}! 😊\n\n${respuesta}`;
    }
    return pick([
      `¡Mucho gusto, ${first}! 😊 ¿En qué te puedo ayudar?`,
      `¡Qué bueno que nos escribes, ${first}! ¿En qué te ayudo?`,
      `Gracias ${first} 🌾 ¿Qué necesitas hoy?`,
    ]);
  }

  if (nombreNuevo) {
    const namePendiente = session.tempData?.namePendiente || '';
    const palabrasPendiente = namePendiente.split(' ').filter(Boolean);
    const palabrasNuevo = nombreNuevo.split(' ').filter(Boolean);

    let nombreFinal;
    if (palabrasNuevo.length >= 2) {
      // El cliente ya dio nombre completo → usar directamente sin combinar
      nombreFinal = nombreNuevo;
    } else if (palabrasPendiente.length >= 2 && palabrasNuevo.length === 1) {
      // Una palabra: combinar primer nombre + nuevo apellido, salvo que repita el primer nombre
      if (palabrasNuevo[0].toLowerCase() !== palabrasPendiente[0].toLowerCase()) {
        nombreFinal = `${palabrasPendiente[0]} ${palabrasNuevo[0]}`;
      } else {
        nombreFinal = nombreNuevo; // el cliente está corrigiendo el primer nombre
      }
    } else {
      nombreFinal = `${palabrasPendiente[0] || ''} ${palabrasNuevo[0]}`.trim();
    }

    const first = primerNombre(nombreFinal);
    if (session.customer?.rowIndex) {
      sheetsService.updateOrderData(session.customer.rowIndex, { name: nombreFinal }).catch(err => console.error('[botLogic] Sheets/Redis error:', err.message));
    }
    await sessionManager.updateSession(phone, {
      flowState: 'active',
      tempData:  { ...session.tempData, name: nombreFinal, namePendiente: undefined },
      customer:  { ...session.customer, name: nombreFinal },
    });

    const intentPrevio = session.tempData?.intentPrevio;
    if (intentPrevio) {
      await sessionManager.updateSession(phone, {
        tempData: { ...session.tempData, intentPrevio: undefined, namePendiente: undefined },
      });
      const updatedSession = await sessionManager.getSession(phone);
      const respuesta = await clasificarIntencion(phone, intentPrevio, updatedSession);
      return `¡Mucho gusto, ${first}! 😊\n\n${respuesta}`;
    }
    return pick([
      `¡Mucho gusto, ${first}! 😊 ¿En qué te puedo ayudar?`,
      `¡Qué bueno que nos escribes, ${first}! ¿En qué te ayudo?`,
      `Gracias ${first} 🌾 ¿Qué necesitas hoy?`,
    ]);
  }

  // No se pudo determinar — preguntar de nuevo
  return '¿Me confirmas tu nombre? 😊';
}

/**
 * Notifica a Wig sobre una escalación
 */
async function notifyWig(phone, session, motivo = '', resumen = '') {
  const wigNumber = process.env.WIG_WHATSAPP_NUMBER;
  if (!wigNumber) {
    console.warn('WIG_WHATSAPP_NUMBER no configurado.');
    return { fueraHorario: false };
  }

  const customer   = session.customer || {};
  const tempData   = session.tempData  || {};
  const history    = (session.conversationHistory || []).slice(-8);
  const transcript = history.length
    ? history.map(m => `${m.role === 'user' ? '👤' : '🤖'}: ${m.content}`).join('\n')
    : '(sin historial previo)';

  const nombre   = customer.name  || tempData.name  || 'Sin nombre';
  const estado   = customer.state || tempData.state || '';
  const ciudad   = customer.city  || tempData.city  || '';
  const cp       = customer.cp    || tempData.cp    || '';
  const resumenF = tempData.resumenEscalacion || motivo || '';

  const resumenLimpio = resumenF
    .replace(/^Perfil mayoreo\/negocio:\s*/i, '')
    .replace(/^Cliente solicita asesor humano\s*/i, '')
    .replace(/^Detectado por Claude\s*/i, '')
    .replace(/^Zona local[^:]*:\s*/i, '')
    .replace(/^"+|"+$/g, '')
    .trim();

  const ubicacion = [estado, ciudad, cp ? `CP: ${cp}` : '']
    .filter(Boolean).join(' | ');

  if (!horarioService.estaEnHorario()) {
    await colaEscalaciones.agregarEscalacion({
      phone, nombre, resumen: resumenLimpio || motivo, timestamp: Date.now(),
    });
    await sessionManager.updateSession(phone, {
      tempData: { ...session.tempData, escalacionPendiente: true },
    });
    console.log(`📥 [COLA] Fuera de horario — escalación de ${nombre} guardada para después`);
    return { fueraHorario: true };
  }

  const telMostrar = phone.replace('whatsapp:', '');
  const esUrgente = (motivo || '').toUpperCase().includes('URGENTE') ||
                    (motivo || '').includes('frustrado') ||
                    (motivo || '').includes('renotificación');

  const msg = esUrgente
    ? `🚨🚨🚨 *URGENTE — ATENDER AHORA*\n\n` +
      `👤 *${nombre}* | ${telMostrar}\n` +
      (ubicacion ? `📍 ${ubicacion}\n` : '') +
      `⚠️ ${resumenLimpio}\n\n` +
      `*Escribe a este número AHORA 👆*`
    : `🚨 *NUEVA SOLICITUD*\n\n` +
      `👤 *${nombre}* | ${telMostrar}\n` +
      (ubicacion ? `📍 ${ubicacion}\n` : '') +
      (resumenLimpio ? `📝 ${resumenLimpio}` : '');

  console.log(`📤 Intentando notificar a Wig | to: ${wigNumber} | motivo: ${motivo}`);
  try {
    const result = await twilioService.sendMessage(wigNumber, msg);
    console.log(`📲 Wig notificado | sid: ${result.sid} | status: ${result.status} | errorCode: ${result.errorCode ?? 'none'} | errorMsg: ${result.errorMessage ?? 'none'}`);
    const falloEnvio = !!result.errorCode ||
      ['failed', 'undelivered'].includes((result.status || '').toLowerCase());
    if (falloEnvio) {
      await colaEscalaciones.agregarEscalacion({ phone, nombre, resumen: resumenLimpio || motivo, timestamp: Date.now() });
      await sessionManager.updateSession(phone, { tempData: { ...session.tempData, escalacionPendiente: true } });
      console.warn(`⚠️ [COLA] Mensaje a Wig falló (errorCode=${result.errorCode ?? 'n/a'}, status=${result.status}) — escalación de ${nombre} guardada en cola`);
    }
    return { fueraHorario: false };
  } catch (err) {
    console.error(`❌ Error notificando a Wig | code: ${err.code} | status: ${err.status} | msg: ${err.message} | moreInfo: ${err.moreInfo}`);
    try {
      await colaEscalaciones.agregarEscalacion({ phone, nombre, resumen: resumenLimpio || motivo, timestamp: Date.now() });
      await sessionManager.updateSession(phone, { tempData: { ...session.tempData, escalacionPendiente: true } });
      console.warn(`⚠️ [COLA] Excepción al notificar a Wig — escalación de ${nombre} guardada en cola`);
    } catch (qErr) {
      console.error('Error guardando escalación en cola:', qErr.message);
    }
    return { fueraHorario: false };
  }
}

module.exports = { handleMessage, handleMediaMessage, notifyWig };
