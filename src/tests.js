#!/usr/bin/env node
/**
 * Comprehensive Unit Tests for 16 New Modules
 * Run with: node src/tests.js
 */

const { strict: assert } = require('assert');
const path = require('path');

// Test utilities
const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║         UNIT TESTS - 16 MÓDULOS NUEVOS                 ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

// 1. VALIDATORS
test('validators.CPValidator.validate() - valid CDMX CP', () => {
  const { CPValidator } = require('./validators');
  const result = CPValidator.validate('01000');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, '01000');
});

test('validators.CPValidator.isCDMX() - valid CDMX CP', () => {
  const { CPValidator } = require('./validators');
  const isCDMX = CPValidator.isCDMX('01000');
  assert.strictEqual(isCDMX, true);
});

test('validators.CPValidator.isEdomex() - valid Edomex CP', () => {
  const { CPValidator } = require('./validators');
  const isEdomex = CPValidator.isEdomex('52000');
  assert.strictEqual(isEdomex, true);
});

test('validators.CPValidator.isNacional() - validates nacional CP', () => {
  const { CPValidator } = require('./validators');
  const result = CPValidator.isNacional('99999');
  assert.strictEqual(result, true); // 99999 is nacional (not CDMX/Edomex)
});

test('validators.PhoneValidator.normalize() - extracts 10 digits', () => {
  const { PhoneValidator } = require('./validators');
  const normalized = PhoneValidator.normalize('5215551234567');
  assert.strictEqual(normalized.length, 10);
  assert.strictEqual(normalized, '5551234567');
});

test('validators.PhoneValidator.validate() - valid 10 digit format', () => {
  const { PhoneValidator } = require('./validators');
  const result = PhoneValidator.validate('5551234567');
  assert.strictEqual(result.valid, true);
});

// 2. PATTERN REGISTRY
test('patternRegistry.test() - detect outside Mexico', () => {
  const PatternRegistry = require('./patternRegistry');
  const result = PatternRegistry.test('OUTSIDE_MEXICO', 'Estoy en USA');
  assert.strictEqual(result, true);
});

test('patternRegistry.test() - detect proveedor (manufacturer)', () => {
  const PatternRegistry = require('./patternRegistry');
  const result = PatternRegistry.test('PROVEEDOR', 'manufacturer');
  assert.strictEqual(result, true);
});

test('patternRegistry.test() - detect distribuidor', () => {
  const PatternRegistry = require('./patternRegistry');
  const result = PatternRegistry.test('DISTRIBUIDOR', 'distribuidor');
  assert.strictEqual(result, true);
});

test('patternRegistry.test() - goodbye single word', () => {
  const PatternRegistry = require('./patternRegistry');
  const result1 = PatternRegistry.test('GOODBYE', 'gracias');
  const result2 = PatternRegistry.test('GOODBYE', 'GRACIAS');
  assert.strictEqual(result1, true);
  assert.strictEqual(result2, true);
});

// 3. MESSAGE UTILS
test('messageUtils.getFirstName() - extracts first name', () => {
  const { getFirstName } = require('./messageUtils');
  const first = getFirstName('Juan Pérez');
  assert.strictEqual(first, 'Juan');
});

test('messageUtils.getFirstName() - handles single name', () => {
  const { getFirstName } = require('./messageUtils');
  const first = getFirstName('Juan');
  assert.strictEqual(first, 'Juan');
});

test('messageUtils.removeEmojis() - strips emoji', () => {
  const { removeEmojis } = require('./messageUtils');
  const clean = removeEmojis('Hola 👋 mundo 🌍');
  assert(!clean.includes('👋'));
  assert(!clean.includes('🌍'));
});

test('messageUtils.cleanBotResponse() - returns string', () => {
  const { cleanBotResponse } = require('./messageUtils');
  const clean = cleanBotResponse('Hola   mundo  \n\n  test');
  assert(typeof clean === 'string');
  assert(clean.length > 0);
});

// 4. ZONE CHECKER
test('zoneChecker.getZoneFromCP() - detects CDMX', () => {
  const ZoneChecker = require('./zoneChecker');
  const zone = ZoneChecker.getZoneFromCP('01500');
  assert(zone && zone.toLowerCase().includes('cdmx'));
});

test('zoneChecker.getZoneFromCP() - detects Edomex', () => {
  const ZoneChecker = require('./zoneChecker');
  const zone = ZoneChecker.getZoneFromCP('52000');
  assert(zone && zone.toLowerCase().includes('edomex'));
});

test('zoneChecker.isViableDelivery() - returns object with viable flag', () => {
  const ZoneChecker = require('./zoneChecker');
  const result = ZoneChecker.isViableDelivery('NACIONAL', 150);
  assert(typeof result === 'object');
  assert(result.viable === false);
});

test('zoneChecker.isViableDelivery() - returns result object', () => {
  const ZoneChecker = require('./zoneChecker');
  const result = ZoneChecker.isViableDelivery('NACIONAL', 1);
  assert(typeof result === 'object');
  assert('viable' in result);
  assert('reason' in result);
});

// 5. CONSTANTS
test('constants.FLOW_STATES enum exists', () => {
  const { FLOW_STATES } = require('./constants');
  assert(FLOW_STATES.ASKING_MEXICO);
  assert(FLOW_STATES.ACTIVE);
  assert(FLOW_STATES.WAITING_FOR_WIG);
});

test('constants.FLOW_STATES has required states', () => {
  const { FLOW_STATES } = require('./constants');
  const states = Object.keys(FLOW_STATES);
  assert(states.length >= 10);
  assert(states.includes('ASKING_MEXICO'));
  assert(states.includes('ACTIVE'));
});

// 6. LOGGER
test('logger functions exist and are callable', () => {
  const logger = require('./logger');
  assert(typeof logger.info === 'function');
  assert(typeof logger.warn === 'function');
  assert(typeof logger.error === 'function');
  assert(typeof logger.success === 'function');
});

test('logger.info() logs message without error', () => {
  const logger = require('./logger');
  // Should not throw
  logger.info('TEST', 'test message');
});

// 7. STATE MACHINE
test('stateMachine.canTransition() - valid transition from asking_mexico', () => {
  const { StateMachine } = require('./stateMachine');
  // asking_mexico can transition to asking_entrega_mx or out_of_coverage
  const can = StateMachine.canTransition('asking_mexico', 'asking_entrega_mx');
  assert.strictEqual(can, true);
});

test('stateMachine.canTransition() - invalid transition', () => {
  const { StateMachine } = require('./stateMachine');
  const can = StateMachine.canTransition('asking_mexico', 'waiting_for_wig');
  assert.strictEqual(can, false);
});

test('stateMachine.isTerminalState() - out_of_coverage is terminal', () => {
  const { StateMachine } = require('./stateMachine');
  const terminal = StateMachine.isTerminalState('out_of_coverage');
  assert.strictEqual(terminal, true);
});

test('stateMachine.isHandoffState() - waiting_for_wig is handoff', () => {
  const { StateMachine } = require('./stateMachine');
  const handoff = StateMachine.isHandoffState('waiting_for_wig');
  assert.strictEqual(handoff, true);
});

// 8. CONFIG
test('config has BUSINESS_HOURS', () => {
  const config = require('./config');
  assert(config.BUSINESS_HOURS);
  assert(config.BUSINESS_HOURS.WEEKDAY_START === 8);
  assert(config.BUSINESS_HOURS.WEEKDAY_END === 17);
});

test('config has SESSION settings', () => {
  const config = require('./config');
  assert(config.SESSION);
  assert(config.SESSION.TTL_SECONDS > 0);
});

// 9. SHEET SCHEMAS
test('sheetSchemas has schema definitions', () => {
  const sheetSchemas = require('./sheetSchemas');
  assert(sheetSchemas.MAESTRO_SCHEMA);
});

// 10. STATE HELPERS
test('stateHelpers functions exist', () => {
  const {
    validateName,
    isGoodbye,
    isConfirmation,
  } = require('./stateHelpers');
  assert(typeof validateName === 'function');
  assert(typeof isGoodbye === 'function');
  assert(typeof isConfirmation === 'function');
});

test('stateHelpers.isConfirmation() - detects single word confirmation', () => {
  const { isConfirmation } = require('./stateHelpers');
  // Pattern needs exact match with ^ and $, so just "si" not "sí, claro"
  const result = isConfirmation('si');
  assert.strictEqual(result, true);
});

test('stateHelpers.isNegation() - detects negation', () => {
  const { isNegation } = require('./stateHelpers');
  const result = isNegation('no');
  assert.strictEqual(result, true);
});

// 11. ACTIVE STATE HANDLERS
test('activeStateHandlers functions exist', () => {
  const {
    detectCP,
    performClaudeChat,
    detectEscalation,
  } = require('./activeStateHandlers');
  assert(typeof detectCP === 'function');
  assert(typeof performClaudeChat === 'function');
  assert(typeof detectEscalation === 'function');
});

// 12. FLOW ORCHESTRATOR
test('flowOrchestrator.getStateGreeting() - returns string', () => {
  const { getStateGreeting } = require('./flowOrchestrator');
  const greeting = getStateGreeting('asking_mexico');
  assert(typeof greeting === 'string');
  assert(greeting.length > 0);
});

test('flowOrchestrator.validateTransition() - validates valid transition', () => {
  const { validateTransition } = require('./flowOrchestrator');
  const result = validateTransition('asking_mexico', 'asking_entrega_mx', '+5215551234567');
  assert(result.allowed === true);
});

test('flowOrchestrator.validateTransition() - rejects invalid transition', () => {
  const { validateTransition } = require('./flowOrchestrator');
  const result = validateTransition('asking_mexico', 'waiting_for_wig', '+5215551234567');
  assert(result.allowed === false);
});

// ═══════════════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════════════════════

if (require.main === module) {
  run().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
  });
}

module.exports = { test, run };
