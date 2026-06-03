/**
 * State Helpers — Simplified state handlers for cleaner handleMessage()
 * Extracts repeated logic patterns from different state handlers
 */

const PatternRegistry = require('./patternRegistry');
const CustomerRegistry = require('./customerRegistry');
const logger = require('./logger');

/**
 * Validate and clean name input
 * @returns {string|null} - cleaned name or null if invalid
 */
function validateName(input, sheetsService) {
  if (!input) return null;
  const cleaned = sheetsService.limpiarNombre(input);
  return cleaned || null;
}

/**
 * Check if customer was previously marked as out of coverage
 * @returns {boolean}
 */
async function isMarkedOutOfCoverage(phone, redis) {
  if (!redis) return false;
  try {
    const marked = await redis.get(`extranjero:${phone}`);
    return !!marked;
  } catch {
    return false;
  }
}

/**
 * Mark customer as out of coverage (foreign)
 */
async function markOutOfCoverage(phone, redis, ttl = 86400) {
  if (!redis) return;
  try {
    await redis.set(`extranjero:${phone}`, '1', 'EX', ttl);
    logger.info('COVERAGE', `Marked as out of coverage: ${phone}`);
  } catch (err) {
    logger.warn('COVERAGE', `Failed to mark out of coverage: ${err.message}`);
  }
}

/**
 * Check if message is a goodbye/end message
 */
function isGoodbye(message) {
  return PatternRegistry.test('GOODBYE', message.trim());
}

/**
 * Check if message is confirmation
 */
function isConfirmation(message) {
  return PatternRegistry.test('CONFIRMATION', message.trim());
}

/**
 * Check if message is negation/refusal
 */
function isNegation(message) {
  return PatternRegistry.test('NEGATION', message.trim());
}

/**
 * Check if this is a reset/restart request
 */
function isResetRequest(message) {
  return PatternRegistry.test('RESET', message.trim());
}

/**
 * Check if outside Mexico
 */
function isOutsideMexico(message) {
  return PatternRegistry.test('OUTSIDE_MEXICO', message);
}

module.exports = {
  validateName,
  isMarkedOutOfCoverage,
  markOutOfCoverage,
  isGoodbye,
  isConfirmation,
  isNegation,
  isResetRequest,
  isOutsideMexico,
};
