/**
 * State Machine — Centralized conversation state transitions
 * Defines valid state transitions and guards against invalid states
 */

const STATES = {
  ASKING_MEXICO: 'asking_mexico',
  ASKING_ENTREGA_MX: 'asking_entrega_mx',
  ASKING_NAME: 'asking_name',
  CONFIRMING_NAME: 'confirming_name',
  ACTIVE: 'active',
  ASKING_CP_BEFORE_ESCALATION: 'asking_cp_before_escalation',
  CONFIRMING_ESCALATION: 'confirming_escalation',
  CONFIRMING_RESET: 'confirming_reset',
  WAITING_FOR_WIG: 'waiting_for_wig',
  ESCALATED: 'escalated',
  OUT_OF_COVERAGE: 'out_of_coverage',
};

// Define valid transitions
const TRANSITIONS = {
  [STATES.ASKING_MEXICO]: [STATES.ASKING_ENTREGA_MX, STATES.OUT_OF_COVERAGE],
  [STATES.ASKING_ENTREGA_MX]: [STATES.ASKING_NAME, STATES.OUT_OF_COVERAGE],
  [STATES.ASKING_NAME]: [STATES.CONFIRMING_NAME],
  [STATES.CONFIRMING_NAME]: [STATES.ACTIVE],
  [STATES.ACTIVE]: [
    STATES.ASKING_CP_BEFORE_ESCALATION,
    STATES.CONFIRMING_RESET,
    STATES.WAITING_FOR_WIG,
    STATES.ESCALATED,
    STATES.OUT_OF_COVERAGE,
  ],
  [STATES.ASKING_CP_BEFORE_ESCALATION]: [
    STATES.ACTIVE,
    STATES.CONFIRMING_ESCALATION,
  ],
  [STATES.CONFIRMING_ESCALATION]: [STATES.WAITING_FOR_WIG, STATES.ACTIVE],
  [STATES.CONFIRMING_RESET]: [STATES.ASKING_NAME, STATES.ACTIVE],
  [STATES.WAITING_FOR_WIG]: [STATES.ACTIVE, STATES.ESCALATED],
  [STATES.ESCALATED]: [STATES.ACTIVE, STATES.WAITING_FOR_WIG],
  [STATES.OUT_OF_COVERAGE]: [STATES.ASKING_NAME], // Can restart
};

class StateMachine {
  /**
   * Check if transition is valid
   * @param {string} fromState
   * @param {string} toState
   * @returns {boolean}
   */
  static canTransition(fromState, toState) {
    if (!TRANSITIONS[fromState]) return false;
    return TRANSITIONS[fromState].includes(toState);
  }

  /**
   * Get all valid next states from current state
   * @param {string} fromState
   * @returns {array}
   */
  static getValidTransitions(fromState) {
    return TRANSITIONS[fromState] || [];
  }

  /**
   * Check if state is a final/terminal state
   * @param {string} state
   * @returns {boolean}
   */
  static isTerminalState(state) {
    return state === STATES.OUT_OF_COVERAGE;
  }

  /**
   * Check if state is a human-handoff state
   * @param {string} state
   * @returns {boolean}
   */
  static isHandoffState(state) {
    return (
      state === STATES.WAITING_FOR_WIG || state === STATES.ESCALATED
    );
  }

  /**
   * Check if state requires collecting input
   * @param {string} state
   * @returns {boolean}
   */
  static isCollectionState(state) {
    return state.startsWith('asking_') || state.startsWith('confirming_');
  }

  /**
   * Get human-readable state name
   * @param {string} state
   * @returns {string}
   */
  static getStateName(state) {
    const names = {
      asking_mexico: 'Verificando cobertura México',
      asking_entrega_mx: 'Verificando dirección México',
      asking_name: 'Solicitando nombre completo',
      confirming_name: 'Confirmando nombre',
      active: 'Conversación activa',
      asking_cp_before_escalation: 'Solicitando CP para escalación',
      confirming_escalation: 'Confirmando escalación',
      confirming_reset: 'Confirmando reinicio',
      waiting_for_wig: 'Esperando asesor Wig',
      escalated: 'Escalado a asesor',
      out_of_coverage: 'Fuera de cobertura',
    };
    return names[state] || state;
  }

  /**
   * Validate that a session has required fields for its state
   * @param {string} state
   * @param {object} session
   * @returns {object} - { valid: boolean, missing: array }
   */
  static validateSessionForState(state, session) {
    const requirements = {
      [STATES.CONFIRMING_NAME]: ['customer.name'],
      [STATES.ACTIVE]: ['customer.name', 'customer.phone'],
      [STATES.WAITING_FOR_WIG]: ['customer.name', 'customer.phone'],
      [STATES.ESCALATED]: ['customer.name', 'customer.phone'],
    };

    const required = requirements[state] || [];
    const missing = [];

    required.forEach(path => {
      const [obj, key] = path.split('.');
      if (!session[obj] || !session[obj][key]) {
        missing.push(path);
      }
    });

    return {
      valid: missing.length === 0,
      missing,
    };
  }
}

module.exports = { StateMachine, STATES };
