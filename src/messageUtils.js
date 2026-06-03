/**
 * Message utilities — Consolidates 3+ repeated patterns for message formatting
 */

/**
 * Clean bot response — remove artifacts, extra whitespace, normalize line breaks
 * Consolidates cleanup logic from 3 different places in botLogic.js
 */
function cleanBotResponse(response) {
  if (!response) return '';

  let cleaned = response
    // Remove ESCALAR markers (internal directives)
    .replace(/\|ESCALAR_A_WIG\|?/g, '')
    .replace(/ESCALAR_A_WIG/g, '')
    // Remove duplicate line breaks (more than 2 in a row)
    .replace(/\n\n\n+/g, '\n\n')
    // Trim leading/trailing whitespace
    .trim();

  return cleaned;
}

/**
 * Pick random variant from array
 * Used for WELCOME_VARIANTS, CHANNEL_VARIANTS, CLOSING_VARIANTS
 */
function pickVariant(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return '';
  return variants[Math.floor(Math.random() * variants.length)];
}

/**
 * Format message for logging — truncate if too long
 */
function formatForLog(message, maxLength = 100) {
  if (!message) return '';
  if (message.length > maxLength) {
    return message.substring(0, maxLength) + '…';
  }
  return message;
}

/**
 * Remove emojis from text (for name validation, etc.)
 */
function removeEmojis(text) {
  return (text || '')
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Emojis
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
    .trim();
}

/**
 * Extract first name from full name
 */
function getFirstName(fullName) {
  if (!fullName) return '';
  return fullName.split(' ')[0];
}

/**
 * Capitalize first letter of each word
 */
function titleCase(text) {
  if (!text) return '';
  return text
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Normalize whitespace in text
 */
function normalizeWhitespace(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ') // Multiple spaces → single space
    .trim();
}

module.exports = {
  cleanBotResponse,
  pickVariant,
  formatForLog,
  removeEmojis,
  getFirstName,
  titleCase,
  normalizeWhitespace,
};
