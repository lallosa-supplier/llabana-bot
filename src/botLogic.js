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
const { messageUtils, getFirstName } = require('./messageUtils');
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
    console.error('🚨 WIG_WHATSAPP_NUMBER no configurado — escalación NO entregada.');
    return { failed: true, reason: 'no_wig_number' };
  }

  const customer   = session.customer || {};
  const tempData   = session.tempData  || {};

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

  // ── Ventana de WhatsApp ────────────────────────────────────────────────────
  // Twilio acepta el mensaje (status:queued, errorCode:null) aunque la ventana de
  // 24h esté cerrada; la entrega real falla async (error 63016) y nunca la vemos
  // aquí. Por eso NO confiamos en la respuesta de Twilio para saber si Wig recibió:
  // usamos su último inbound (registrado en webhookHandler) para estimar la ventana.
  const VENTANA_MS = 24 * 60 * 60 * 1000;
  const redis = sessionManager.getRedisClient && sessionManager.getRedisClient();
  const leerTs = async (key) => {
    if (!redis) return 0;
    try { return parseInt((await redis.get(key)) || '0', 10) || 0; } catch (e) { return 0; }
  };
  const lastWig = await leerTs('wig:lastInbound');
  const ventanaWigAbierta = lastWig > 0 && (Date.now() - lastWig) < VENTANA_MS;

  // Intento best-effort de avisar a Wig. Aunque creamos la ventana cerrada lo
  // mandamos igual: si el timestamp se perdió (Redis reinició) podría entregarse;
  // si de verdad está cerrada, no se entrega y no cuesta nada.
  let wigOk = false;
  console.log(`📤 Notificando a Wig | to: ${wigNumber} | ventana: ${ventanaWigAbierta ? 'abierta' : 'CERRADA'} | motivo: ${motivo}`);
  try {
    const result = await twilioService.sendMessage(wigNumber, msg);
    console.log(`📲 Wig | sid: ${result.sid} | status: ${result.status} | errorCode: ${result.errorCode ?? 'none'}`);
    const falloInmediato = !!result.errorCode ||
      ['failed', 'undelivered'].includes((result.status || '').toLowerCase());
    wigOk = ventanaWigAbierta && !falloInmediato;
  } catch (err) {
    console.error(`❌ Error enviando a Wig | code: ${err.code} | msg: ${err.message}`);
  }

  if (wigOk) return { notified: true };

  // ── Wig no confiable (ventana cerrada o fallo): respaldo a Diego + cola ──────
  console.warn(`🚨 No se pudo asegurar el aviso a Wig (ventana ${ventanaWigAbierta ? 'abierta pero Twilio falló' : 'cerrada'}). Intentando respaldo.`);

  // Siempre dejar la escalación en la cola para que /pendientes la recupere.
  try {
    await colaEscalaciones.agregarEscalacion({ phone, nombre, resumen: resumenLimpio || motivo, timestamp: Date.now() });
  } catch (qErr) {
    console.error('Error guardando escalación en cola:', qErr.message);
  }

  const backupNumber = process.env.BACKUP_WHATSAPP_NUMBER;
  if (backupNumber) {
    const lastBackup = await leerTs('backup:lastInbound');
    const ventanaBackupAbierta = lastBackup > 0 && (Date.now() - lastBackup) < VENTANA_MS;
    if (ventanaBackupAbierta) {
      const msgBackup =
        `🚨 *No pude avisar a Wig* (su ventana de WhatsApp está cerrada).\n\n` +
        `👤 *${nombre}* | ${telMostrar}\n` +
        (ubicacion ? `📍 ${ubicacion}\n` : '') +
        (resumenLimpio ? `📝 ${resumenLimpio}\n` : '') +
        `\nPídele a Wig que le escriba al bot para reabrir su ventana, o atiéndelo tú.`;
      try {
        const r = await twilioService.sendMessage(backupNumber, msgBackup);
        const falloB = !!r.errorCode || ['failed', 'undelivered'].includes((r.status || '').toLowerCase());
        if (!falloB) {
          console.warn(`📲 Respaldo: aviso entregado a Diego (Wig no disponible). Cliente: ${nombre}`);
          return { failed: true, reason: 'ventana_cerrada', backup: true };
        }
      } catch (e) {
        console.error(`❌ Error avisando al respaldo: ${e.message}`);
      }
    } else {
      console.warn(`🚨 Ventana del respaldo (Diego) también cerrada.`);
    }
  }

  // Último recurso: nadie recibió el aviso en vivo (queda en la cola → /pendientes).
  console.error(`🚨🚨 ESCALACIÓN SIN AVISO EN VIVO — ni Wig ni respaldo disponibles. Cliente: ${nombre} | ${telMostrar} | ${resumenLimpio || motivo}. Recuperable con /pendientes.`);
  return { failed: true, reason: 'ventana_cerrada' };
}

module.exports = { handleMessage, handleMediaMessage, notifyWig };
