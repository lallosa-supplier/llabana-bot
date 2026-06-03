/**
 * Flow Orchestrator — Coordinates message routing through conversation states
 * Simplifies botLogic.js by centralizing state dispatch logic
 */

const { StateMachine, STATES } = require('./stateMachine');
const SessionUpdaters = require('./sessionUpdaters');
const logger = require('./logger');

/**
 * Route message to appropriate handler based on current state
 * @param {string} message - User's input message
 * @param {string} currentState - Current conversation state
 * @param {object} session - Current session
 * @param {object} handlers - State handler functions
 * @returns {object} - { nextState, response, handled }
 */
async function routeMessage(message, currentState, session, handlers) {
  logger.debug('FLOW', `Routing message in state: ${currentState}`);

  // Validate we have a handler for this state
  if (!handlers[currentState]) {
    logger.warn('FLOW', `No handler for state: ${currentState}`);
    return {
      nextState: currentState,
      response: 'Disculpa, hubo un error en el flujo. Intenta de nuevo.',
      handled: false,
    };
  }

  try {
    const handler = handlers[currentState];
    const result = await handler(message, session);

    return {
      ...result,
      handled: true,
    };
  } catch (err) {
    logger.error('FLOW', `Error in state handler ${currentState}`, err);
    return {
      nextState: currentState,
      response: 'Tuve un problema. ¿Podrías repetir?',
      handled: false,
    };
  }
}

/**
 * Attempt state transition with validation
 * @param {string} fromState - Current state
 * @param {string} toState - Desired next state
 * @param {string} phone - Customer phone (for logging)
 * @returns {object} - { allowed: boolean, message: string }
 */
function validateTransition(fromState, toState, phone) {
  if (!StateMachine.canTransition(fromState, toState)) {
    const validStates = StateMachine.getValidTransitions(fromState);
    logger.warn(
      'STATE_VIOLATION',
      `Invalid transition ${fromState} → ${toState} for ${phone}`
    );
    return {
      allowed: false,
      message: `Transición inválida: ${fromState} no puede ir a ${toState}`,
      validStates,
    };
  }

  return {
    allowed: true,
    message: `Transición válida: ${fromState} → ${toState}`,
  };
}

/**
 * Handle state transition with logging and persistence
 * @param {string} phone
 * @param {string} fromState
 * @param {string} toState
 * @returns {object} - { transitioned: boolean, error?: string }
 */
async function transitionState(phone, fromState, toState) {
  const validation = validateTransition(fromState, toState, phone);

  if (!validation.allowed) {
    return {
      transitioned: false,
      error: validation.message,
    };
  }

  try {
    await SessionUpdaters.updateState(phone, toState);
    logger.info('STATE_TRANSITION', `${phone}: ${fromState} → ${toState}`);
    return { transitioned: true };
  } catch (err) {
    logger.error('STATE_TRANSITION', `Failed to transition ${phone}`, err);
    return {
      transitioned: false,
      error: `Failed to save state: ${err.message}`,
    };
  }
}

/**
 * Get the appropriate greeting for a state
 * @param {string} state
 * @param {string} customerName - Optional name for personalization
 * @returns {string}
 */
function getStateGreeting(state, customerName = null) {
  const greetings = {
    [STATES.ASKING_MEXICO]: '¿Estás en México? 🇲🇽',
    [STATES.ASKING_ENTREGA_MX]: '¿Tienes una dirección de entrega en México?',
    [STATES.ASKING_NAME]: '¿Con quién tengo el gusto? Por favor, tu nombre completo y apellido.',
    [STATES.CONFIRMING_NAME]: (name) =>
      `Perfecto, ¿confirmas que te llamas ${name}?`,
    [STATES.ACTIVE]: (name) =>
      name ? `¡Hola ${name}! ¿En qué te puedo ayudar? 😊` : '¿En qué te puedo ayudar?',
    [STATES.ASKING_CP_BEFORE_ESCALATION]: '¿Cuál es tu código postal? 📍',
    [STATES.CONFIRMING_ESCALATION]:
      '¿Estás listo para hablar con un asesor? 👤',
    [STATES.WAITING_FOR_WIG]: '✋ Un momento, te estoy conectando con nuestro asesor...',
    [STATES.OUT_OF_COVERAGE]:
      'Disculpa, actualmente solo operamos en México. 🇲🇽',
  };

  const greeting = greetings[state];
  if (typeof greeting === 'function') {
    return greeting(customerName);
  }
  return greeting || 'Hola 👋';
}

/**
 * Check if conversation should auto-close
 * @param {string} state
 * @param {object} session
 * @returns {boolean}
 */
function shouldAutoClose(state, session) {
  // Terminal states
  if (state === STATES.OUT_OF_COVERAGE) return true;

  // Handoff states should stay open
  if (StateMachine.isHandoffState(state)) return false;

  return false;
}

module.exports = {
  routeMessage,
  validateTransition,
  transitionState,
  getStateGreeting,
  shouldAutoClose,
};
