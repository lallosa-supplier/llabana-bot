# Module Quick Reference

## 🚀 Quick Import Guide

Copy-paste ready imports for common tasks:

### Validation & Parsing
```javascript
const { CPValidator, PhoneValidator } = require('./validators');

// CP: validate('01000') → { valid: true, zone: 'CDMX' }
// Phone: normalize('+5215551234567') → '+5215551234567'
const validation = CPValidator.validate(userInput);
const normalized = PhoneValidator.normalize(phoneNumber);
```

### Pattern Matching
```javascript
const PatternRegistry = require('./patternRegistry');

if (PatternRegistry.test('OUTSIDE_MEXICO', message)) { /* escalate */ }
if (PatternRegistry.test('PROVEEDOR', message)) { /* handle provider */ }
if (PatternRegistry.test('DISTRIBUIDOR', message)) { /* handle distributor */ }
```

### Logging
```javascript
const logger = require('./logger');

logger.info('CATEGORY', 'User-friendly message');
logger.warn('CATEGORY', 'Warning message');
logger.error('CATEGORY', 'Error message', err);
logger.success('CATEGORY', 'Success message');
```

### State Management
```javascript
const SessionUpdaters = require('./sessionUpdaters');
const { StateMachine } = require('./stateMachine');

// Update state atomically
await SessionUpdaters.updateState(phone, 'active');
await SessionUpdaters.updateCustomerInfo(phone, { name: 'Juan', cp: '28001' });

// Validate transitions
if (!StateMachine.canTransition('asking_name', 'active')) { /* handle */ }
```

### Message Utilities
```javascript
const { cleanBotResponse, getFirstName, removeEmojis } = require('./messageUtils');

const clean = cleanBotResponse(claudeResponse);
const firstName = getFirstName('Juan Pérez'); // 'Juan'
const noEmoji = removeEmojis('Hola 👋 mundo'); // 'Hola  mundo'
```

### Zone/Delivery Detection
```javascript
const ZoneChecker = require('./zoneChecker');

const zone = ZoneChecker.getZoneFromCP('01500'); // 'CDMX'
const viableDelivery = ZoneChecker.isViableDelivery(zone, 150); // false (too many for paquetería)
```

### Customer Registry
```javascript
const CustomerRegistry = require('./customerRegistry');

const customer = await CustomerRegistry.registerOrFind(phone);
await CustomerRegistry.addTag(customer.rowIndex, 'Reparto');
await CustomerRegistry.logConversation(customer.rowIndex, transcript);
```

### Claude Wrappers
```javascript
const { askClaudeAboutProduct, askClaudeForAssistance } = require('./claudeWrappers');

const response = await askClaudeAboutProduct(history, customer, 'Purina');
const help = await askClaudeForAssistance(history, customer, userMessage);
```

### Escalation Management
```javascript
const EscalationManager = require('./escalationManager');

await EscalationManager.escalate(phone, session, 'Distribuidor potencial', {
  quantity: 500,
  city: 'CDMX',
});
```

## 🔍 Module Dependency Map

```
┌─────────────────────────────────────────┐
│ logger.js (no dependencies)             │
├─────────────────────────────────────────┤
│ config.js, constants.js (no logic deps) │
├─────────────────────────────────────────┤
│ validators.js, messageUtils.js          │
│ patternRegistry.js, sheetSchemas.js     │
├─────────────────────────────────────────┤
│ zoneChecker.js (uses validators)        │
│ stateHelpers.js (uses patternRegistry)  │
├─────────────────────────────────────────┤
│ sessionManager.js → sessionUpdaters.js  │
│ customerRegistry.js (uses sheets)       │
│ activeStateHandlers.js (uses utilities) │
├─────────────────────────────────────────┤
│ claudeWrappers.js (uses claudeService)  │
│ escalationManager.js (uses sessionMgr)  │
│ stateMachine.js, flowOrchestrator.js    │
├─────────────────────────────────────────┤
│ botLogic.js (orchestrates everything)   │
└─────────────────────────────────────────┘
```

## 📋 Common Patterns

### Validate and update customer info
```javascript
const { CPValidator } = require('./validators');
const SessionUpdaters = require('./sessionUpdaters');

const cp = '28001';
const validation = CPValidator.validate(cp);
if (validation.valid) {
  await SessionUpdaters.updateCustomerInfo(phone, {
    cp,
    state: validation.state,
  });
}
```

### Check for escalation trigger
```javascript
const PatternRegistry = require('./patternRegistry');
const EscalationManager = require('./escalationManager');

if (PatternRegistry.test('PROVEEDOR', message)) {
  await EscalationManager.escalate(phone, session, 'Proveedor potencial');
}
```

### Handle state transition
```javascript
const { StateMachine } = require('./stateMachine');
const flowOrchestrator = require('./flowOrchestrator');

if (StateMachine.canTransition(currentState, 'asking_cp_before_escalation')) {
  const { transitioned } = await flowOrchestrator.transitionState(
    phone,
    currentState,
    'asking_cp_before_escalation'
  );
  if (transitioned) {
    // Show prompt for CP
  }
}
```

### Process Claude response with validation
```javascript
const { askClaudeForAssistance } = require('./claudeWrappers');
const PatternRegistry = require('./patternRegistry');

const response = await askClaudeForAssistance(history, customer, message);
if (!response || PatternRegistry.test('ESCALATION_PROFILE', message)) {
  // Escalate to Wig
}
```

## ⚠️ Common Gotchas

1. **SessionUpdaters requires async/await**
   ```javascript
   // ❌ WRONG
   SessionUpdaters.updateState(phone, 'active');
   
   // ✅ CORRECT
   await SessionUpdaters.updateState(phone, 'active');
   ```

2. **PatternRegistry.test() is case-insensitive**
   ```javascript
   // Both work
   PatternRegistry.test('GOODBYE', 'Gracias'); // true
   PatternRegistry.test('GOODBYE', 'gracias'); // true
   ```

3. **Logger requires category prefix**
   ```javascript
   // ❌ WRONG
   logger.info('message without category');
   
   // ✅ CORRECT
   logger.info('CATEGORY', 'message with category');
   ```

4. **CPValidator rejects invalid ranges**
   ```javascript
   // ❌ WRONG - CP out of valid range
   CPValidator.validate('99999'); // { valid: false }
   
   // ✅ CORRECT
   CPValidator.validate('28001'); // { valid: true, zone: 'EDOMEX', state: 'CDMX' }
   ```

## 🔧 Testing Each Module

```bash
# Pattern matching
node -e "const PR = require('./src/patternRegistry'); console.log(PR.test('GOODBYE', 'gracias'))"

# Validation
node -e "const V = require('./src/validators'); console.log(V.CPValidator.validate('28001'))"

# State machine
node -e "const S = require('./src/stateMachine'); console.log(S.StateMachine.canTransition('asking_name', 'confirming_name'))"

# Logger
node -e "const L = require('./src/logger'); L.info('TEST', 'test message')"
```

---

**Last updated:** 2026-06-03  
**Modules:** 16 new, fully tested and production-ready
