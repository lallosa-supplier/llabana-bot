/**
 * Claude Service Wrappers — Context-aware AI integration
 * Consolidates 8+ scattered Claude calls into typed interfaces
 */

const claudeService = require('./claudeService');
const logger = require('./logger');

/**
 * Ask Claude about a product/recommendation
 */
async function askClaudeAboutProduct(history, customer, productName) {
  try {
    const response = await claudeService.chat(history, customer);
    if (!response) {
      logger.warn('CLAUDE', 'Empty response from API');
      return 'Disculpa, no pude procesar tu pregunta. ¿Podrías intentar de nuevo?';
    }
    return response;
  } catch (err) {
    logger.error('CLAUDE_PRODUCT', 'Error getting product recommendation', err);
    return 'Hubo un problema al consultar sobre ese producto. Intenta de nuevo.';
  }
}

/**
 * Ask Claude if customer should be escalated (general flow)
 */
async function askClaudeForAssistance(history, customer, userMessage) {
  try {
    const response = await claudeService.chat(history, customer);
    if (!response) {
      return 'Disculpa, tuve un problema. ¿Podrías repetir tu pregunta?';
    }

    // Check if Claude detected need for escalation
    if (response.includes('ESCALAR_A_WIG')) {
      logger.info('CLAUDE_ESCALATE', 'Claude detected escalation need');
      return null; // Signal to escalate
    }

    return response;
  } catch (err) {
    logger.error('CLAUDE_ASSIST', 'Error in Claude assistance', err);
    return 'Tuve un problema técnico. Por favor intenta de nuevo.';
  }
}

/**
 * Ask Claude to process a complaint/queja
 */
async function askClaudeProcessComplaint(history, customer, complaint) {
  try {
    const response = await claudeService.chat(history, customer);
    logger.info('CLAUDE_COMPLAINT', 'Complaint processed through Claude');
    return response;
  } catch (err) {
    logger.error('CLAUDE_COMPLAINT', 'Error processing complaint', err);
    return 'Entendemos tu preocupación. Voy a escalarlo con nuestro equipo.';
  }
}

/**
 * Get Claude's recommendation for a quantity/zone combination
 */
async function askClaudeForDeliveryRecommendation(
  history,
  customer,
  quantity,
  zone
) {
  try {
    const response = await claudeService.chat(history, customer);
    logger.debug('CLAUDE_DELIVERY', `Recommendation for ${quantity} units in ${zone}`);
    return response;
  } catch (err) {
    logger.error('CLAUDE_DELIVERY', 'Error getting delivery recommendation', err);
    return null;
  }
}

/**
 * Validate if Claude thinks the conversation can close
 */
async function askClaudeCanClose(history, customer) {
  try {
    const response = await claudeService.chat(history, customer);

    // Check for closure signals
    const canClose = response && !response.includes('ESCALAR_A_WIG');
    logger.debug('CLAUDE_CLOSE', `Closure validation: ${canClose}`);

    return response;
  } catch (err) {
    logger.error('CLAUDE_CLOSE', 'Error validating closure', err);
    return null;
  }
}

module.exports = {
  askClaudeAboutProduct,
  askClaudeForAssistance,
  askClaudeProcessComplaint,
  askClaudeForDeliveryRecommendation,
  askClaudeCanClose,
};
