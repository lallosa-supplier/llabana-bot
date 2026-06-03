/**
 * Constants centralizadas para el bot — evita magic strings
 */

const FLOW_STATES = {
  ASKING_MEXICO: 'asking_mexico',
  ASKING_ENTREGA_MX: 'asking_entrega_mx',
  ASKING_NAME: 'asking_name',
  CONFIRMING_NAME: 'confirming_name',
  ACTIVE: 'active',
  WAITING_FOR_WIG: 'waiting_for_wig',
  ESCALATED: 'escalated',
  ASKING_CP_BEFORE_ESCALATION: 'asking_cp_before_escalation',
  CONFIRMING_ESCALATION: 'confirming_escalation',
  CONFIRMING_RESET: 'confirming_reset',
  OUT_OF_COVERAGE: 'out_of_coverage',
};

const TIME_CONSTANTS = {
  CUTOFF_HOUR: 14, // 2pm
  BUSINESS_HOURS_START: 8,
  BUSINESS_HOURS_END: 17,
  SATURDAY_START: 9,
  SATURDAY_END: 14,
  FOLLOWUP_A_DELAY: 2 * 60 * 60 * 1000, // 2 horas
  FOLLOWUP_C_DELAY: 23 * 60 * 60 * 1000, // 23 horas
  SESSION_TTL: 30 * 60 * 60 * 1000, // 30 horas
};

const MESSAGES = {
  OUT_OF_COVERAGE: 'Gracias por escribirnos 🙏 Por ahora solo tenemos entregas en México. Cuando estés por acá con gusto te ayudamos 🌾',
  WELCOME_VARIANTS: [
    '¡Hola! 👋 Soy el asistente de Llabana, tu aliado en alimento balanceado 🌾 ¿Estás en México?',
    '¡Bienvenido! 🌾 Soy el asistente de Llabana. ¿Nos escribes desde México?',
    '¡Hola! 👋 Llabana, alimento balanceado para tus animales 🌾 ¿Estás en México?',
  ],
};

module.exports = { FLOW_STATES, TIME_CONSTANTS, MESSAGES };
