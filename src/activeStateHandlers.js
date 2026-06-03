/**
 * Active State Handlers — Breaks down handleActive() complexity
 * Originally handleActive() was 800+ lines with 8 distinct responsibilities
 * This splits it into testable, maintainable functions
 */

const claudeService = require('./claudeService');
const sheetsService = require('./sheetsService');
const sessionManager = require('./sessionManager');
const PatternRegistry = require('./patternRegistry');
const CustomerRegistry = require('./customerRegistry');
const ZoneChecker = require('./zoneChecker');
const { CPValidator } = require('./validators');
const { cleanBotResponse, getFirstName } = require('./messageUtils');
const logger = require('./logger');

/**
 * Detect and extract CP from message
 * @returns {string|null} - CP if found and valid, null otherwise
 */
async function detectCP(message, session, phone) {
  const cpMatch = message.match(/(?<!\d)(\d{5})(?!\d)/);
  if (!cpMatch) return null;

  const cp = cpMatch[1];
  const validation = CPValidator.validate(cp);
  if (!validation.valid) return null;

  // Update session and Sheets with CP
  const cpData = { cp };
  if (!session.customer?.state) {
    cpData.state = ZoneChecker.getStateName(cp);
  }

  await sessionManager.updateSession(phone, { customer: { ...session.customer, ...cpData } });
  if (session.customer?.rowIndex) {
    await CustomerRegistry.updateCustomer(session.customer.rowIndex, cpData);
  }

  logger.info('CP_DETECT', `CP found: ${cp}`);
  return cp;
}

/**
 * Handle distributor flow (asking for city, type of business, volume)
 * @returns {string} - bot response or null if flow not started
 */
async function handleDistributorFlow(message, session, phone) {
  const infoDistribuidor = session.tempData?.infoDistribuidor || {};

  if (!infoDistribuidor.esperando) {
    // Check if message indicates distributor intent
    if (!PatternRegistry.test('DISTRIBUIDOR', message)) return null;

    // Start flow
    await sessionManager.updateSession(phone, {
      tempData: {
        ...session.tempData,
        infoDistribuidor: { esperando: 'ciudad' },
      },
    });
    return '¿De qué ciudad eres? 🏙️';
  }

  // Continue flow based on what we're waiting for
  const step = infoDistribuidor.esperando;

  if (step === 'ciudad') {
    await sessionManager.updateSession(phone, {
      tempData: {
        ...session.tempData,
        infoDistribuidor: { ...infoDistribuidor, ciudad: message, esperando: 'tipo_negocio' },
      },
    });
    return '¿Qué tipo de negocio tienes? (tienda, veterinaria, granja, otro)';
  }

  if (step === 'tipo_negocio') {
    await sessionManager.updateSession(phone, {
      tempData: {
        ...session.tempData,
        infoDistribuidor: { ...infoDistribuidor, tipoNegocio: message, esperando: 'volumen' },
      },
    });
    return '¿Aproximadamente cuántos bultos necesitarías al mes? 📦';
  }

  if (step === 'volumen') {
    const info = {
      ...infoDistribuidor,
      volumen: message,
      completado: true,
    };

    logger.info('DISTRIBUIDOR', `Distributor info collected: ${info.ciudad}, ${info.tipoNegocio}, ${info.volumen}`);

    return 'Perfecto 🙌 Voy a conectarte con nuestro asesor para hablar de distribución.';
  }

  return null;
}

/**
 * Handle provider flow (asking for product, company, position, contact)
 */
async function handleProveedorFlow(message, session, phone) {
  const infoProveedor = session.tempData?.infoProveedor || {};

  if (!infoProveedor.esperando) {
    // Check if message indicates provider intent
    if (!PatternRegistry.test('PROVEEDOR', message)) return null;

    await sessionManager.updateSession(phone, {
      tempData: {
        ...session.tempData,
        infoProveedor: { esperando: 'producto' },
      },
    });
    return '¿Qué producto o servicio ofreces? 🏭';
  }

  const step = infoProveedor.esperando;

  if (step === 'producto') {
    await sessionManager.updateSession(phone, {
      tempData: {
        ...session.tempData,
        infoProveedor: { ...infoProveedor, producto: message, esperando: 'empresa' },
      },
    });
    return '¿Cuál es el nombre de tu empresa? 🏢';
  }

  if (step === 'empresa') {
    await sessionManager.updateSession(phone, {
      tempData: {
        ...session.tempData,
        infoProveedor: { ...infoProveedor, empresa: message, esperando: 'puesto' },
      },
    });
    return '¿Cuál es tu puesto en la empresa? 👤';
  }

  if (step === 'puesto') {
    await sessionManager.updateSession(phone, {
      tempData: {
        ...session.tempData,
        infoProveedor: { ...infoProveedor, puesto: message, esperando: 'contacto' },
      },
    });
    return '¿Cuál es el mejor número o email para contactarte? 📞';
  }

  if (step === 'contacto') {
    const info = {
      ...infoProveedor,
      contacto: message,
      completado: true,
    };

    logger.info('PROVEEDOR', `Provider info collected: ${info.empresa} - ${info.producto}`);

    return 'Perfecto 🙌 Voy a compartir tu información con nuestro equipo de compras.';
  }

  return null;
}

/**
 * Perform Claude chat with conversation history
 * Wrapper around claudeService.chat() with consistent error handling
 */
async function performClaudeChat(session, customer, message) {
  try {
    const respClaude = await claudeService.chat(
      session.conversationHistory,
      customer
    );

    if (!respClaude || respClaude.includes('ESCALAR_A_WIG')) {
      return null; // Signal to escalate
    }

    return respClaude;
  } catch (err) {
    logger.error('CLAUDE', 'Error calling Claude API', err);
    return 'Disculpa, tuve un problema técnico. ¿Podrías intentar de nuevo?';
  }
}

/**
 * Detect escalation signals in message and Claude response
 * @returns {string|null} - reason if should escalate, null otherwise
 */
async function detectEscalation(message, claudeResponse, session) {
  // Check Claude response for escalation marker
  if (claudeResponse && claudeResponse.includes('ESCALAR_A_WIG')) {
    return 'Claude detection';
  }

  // Check for explicit human request
  if (PatternRegistry.test('HUMAN_REQUEST', message)) {
    return 'Explicit human request';
  }

  // Check for price questions (escalate to confirm)
  if (PatternRegistry.test('PRICE_QUESTION', message)) {
    return 'Pricing question';
  }

  return null;
}

module.exports = {
  detectCP,
  handleDistributorFlow,
  handleProveedorFlow,
  performClaudeChat,
  detectEscalation,
};
