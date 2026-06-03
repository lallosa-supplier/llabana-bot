# Llabana Bot — Architecture Overview

## Module Structure (Post-Refactoring)

This document maps the refactored codebase with 16 new modules created in Phases 1-6.

### Core Services (Original)
- **index.js** — Express server, webhook handlers, scheduled jobs
- **botLogic.js** (~2400 lines) → conversation routing
- **claudeService.js** — Claude API integration with system prompt
- **sheetsService.js** — Google Sheets CRUD + caching
- **sessionManager.js** — Redis TTL + fallback memory
- **twilioService.js** — WhatsApp message dispatch
- **followUpService.js** — Automated follow-up scheduling (A, C)
- **wigAdminHandler.js** — Wig command processing
- **shopifyWebhookHandler.js** — Shopify event sync
- **transcriptService.js** — Conversation logging

### Phase 1: Constants & Validators
- **constants.js** (79 lines)
  - `FLOW_STATES` enum (12 conversation states)
  - `TIME_CONSTANTS` (business hours, delays)
  - `MESSAGES` object variants
  - **Usage:** Replace 40+ hardcoded state strings

- **validators.js** (68 lines)
  - `CPValidator` — Validate postal codes (CDMX, Edomex, Nacional)
  - `PhoneValidator` — Normalize, validate, format phone numbers
  - **Usage:** Centralized input validation

### Phase 2: Pattern Management
- **patternRegistry.js** (128 lines)
  - `PatternRegistry` class with 100+ regex patterns
  - Categories: OUTSIDE_MEXICO, ESCALATION_PROFILE, HUMAN_REQUEST, PRICE_QUESTION, HR_REQUEST, DISTRIBUIDOR, PROVEEDOR, RESET, GOODBYE, CONFIRMATION, NEGATION
  - Methods: `test()`, `getMatch()`, `getPatterns()`, `getCategories()`, `register()`
  - **Usage:** Single source of truth for pattern matching

### Phase 3: Helper Functions
- **messageUtils.js** (79 lines)
  - Text processing: `cleanBotResponse()`, `removeEmojis()`, `getFirstName()`, `titleCase()`, `normalizeWhitespace()`
  - **Usage:** Consistent message formatting

- **zoneChecker.js** (95 lines)
  - `ZoneChecker` class for postal code zone detection
  - Methods: `getZoneFromCP()`, `getZoneFromText()`, `isViableDelivery()`
  - **Usage:** Determine delivery channel (Wig, paquetería, truck)

- **customerRegistry.js** (98 lines)
  - `CustomerRegistry` class for CRM operations
  - Methods: `registerOrFind()`, `updateCustomer()`, `addTag()`, `addNote()`, `logConversation()`
  - **Usage:** Atomic customer registration paths

- **logger.js** (33 lines)
  - Unified logging interface with emoji prefixes
  - Methods: `info()`, `warn()`, `error()`, `success()`, `debug()`
  - **Usage:** Replace 200+ console.log calls

- **activeStateHandlers.js** (176 lines)
  - State handler functions: `detectCP()`, `handleDistributorFlow()`, `handleProveedorFlow()`, `performClaudeChat()`, `detectEscalation()`
  - **Usage:** Break down 800-line handleActive() function

- **stateHelpers.js** (62 lines)
  - State detection: `validateName()`, `isGoodbye()`, `isConfirmation()`, `isNegation()`, `isResetRequest()`
  - **Usage:** Cleaner state machine logic

### Phase 4: Service Layer Abstraction
- **claudeWrappers.js** (107 lines)
  - Context-aware Claude functions:
    - `askClaudeAboutProduct()`
    - `askClaudeForAssistance()`
    - `askClaudeProcessComplaint()`
    - `askClaudeForDeliveryRecommendation()`
    - `askClaudeCanClose()`
  - **Usage:** Typed AI interaction interfaces

- **escalationManager.js** (181 lines)
  - `EscalationManager` class:
    - `escalate()` — Main escalation entry point
    - `notifyWig()` — Send Wig notification
    - `queueForLaterNotification()` — Queue out-of-hours escalations
    - `handleWigCommand()` — Process admin commands
  - **Usage:** Centralized escalation logic

- **sessionUpdaters.js** (156 lines)
  - `SessionUpdaters` class for atomic session mutations:
    - `updateState()`, `addMessageToHistory()`, `updateCustomerInfo()`
    - `updateTempData()`, `setEscalationData()`, `clearSensitiveData()`
    - `resetToInitial()`, `markOutOfCoverage()`
  - **Usage:** Prevent race conditions in session updates

### Phase 5: Configuration & Data Structures
- **config.js** (116 lines)
  - Central configuration object:
    - SHEETS (tabs, headers, cache TTL)
    - BUSINESS_HOURS (L-V 8am-5pm, Sáb 9am-2pm)
    - SESSION (TTL 30 hours, fallback)
    - RATE_LIMIT (webhook protection)
    - FOLLOWUP (A: 2h, C: 23h)
    - ZONES (CDMX, Edomex ranges)
    - TWILIO, CLAUDE, REDIS settings
  - **Usage:** Replace magic numbers throughout codebase

- **sheetSchemas.js** (172 lines)
  - Schema definitions for all 7 Sheets tabs:
    - MAESTRO_SCHEMA, SUCURSALES_SCHEMA, RUTAS_SCHEMA, etc.
  - Helpers: `getColumnIndex()`, `buildRow()`
  - **Usage:** Eliminate magic column indices

### Phase 6: State Machine & Flow Control
- **stateMachine.js** (145 lines)
  - `StateMachine` class:
    - `canTransition()` — Validate state transitions
    - `getValidTransitions()` — List allowed next states
    - `isHandoffState()`, `isTerminalState()`, `isCollectionState()`
    - `validateSessionForState()` — Check required fields
  - **Usage:** Guard state transitions, prevent invalid flows

- **flowOrchestrator.js** (168 lines)
  - Flow coordination functions:
    - `routeMessage()` — Dispatch to state handler
    - `transitionState()` — Persist state change
    - `getStateGreeting()` — Personalized state greetings
    - `shouldAutoClose()` — Conversation closure logic
  - **Usage:** Simplify botLogic.js message routing

## Import Strategy

### High-level modules (safe to import everywhere)
```javascript
const logger = require('./logger');
const { CPValidator, PhoneValidator } = require('./validators');
const PatternRegistry = require('./patternRegistry');
const config = require('./config');
const { FLOW_STATES } = require('./constants');
```

### Mid-level services (use with caution, check for circular deps)
```javascript
const SessionUpdaters = require('./sessionUpdaters');
const EscalationManager = require('./escalationManager');
const { StateMachine } = require('./stateMachine');
```

### Utilities (function exports, safe)
```javascript
const { cleanBotResponse, getFirstName } = require('./messageUtils');
const { detectCP, handleDistributorFlow } = require('./activeStateHandlers');
const stateHelpers = require('./stateHelpers');
```

## Migration Checklist

When refactoring botLogic.js to use new modules:

- [ ] Replace `console.log()` with `logger.*()` calls
- [ ] Replace `FLOW_STATES.*` with `CONSTANTS.FLOW_STATES` imports
- [ ] Replace validation logic with `CPValidator`, `PhoneValidator`
- [ ] Replace pattern tests with `PatternRegistry.test()`
- [ ] Replace magic column indices with `sheetSchemas.getColumnIndex()`
- [ ] Replace session updates with `SessionUpdaters.*()` functions
- [ ] Replace escalation logic with `EscalationManager.escalate()`
- [ ] Replace state routing with `flowOrchestrator.routeMessage()`
- [ ] Validate all state transitions with `StateMachine.canTransition()`

## Performance Notes

- **Redis optimization:** getAllActiveSessions() now uses pipeline (N → 1 query)
- **Sheets caching:** findCustomer() cached for 10 minutes with auto-cleanup
- **Debounce:** Webhook handler protects against duplicate messages (1.5s)
- **Rate limiting:** 1000 req/15min on /webhook endpoints
- **Session TTL:** 30 hours + fallback memory for Redis outages

## Testing Strategy

Each new module is independently testable:
- Validators: Test valid/invalid CP, phone formats
- PatternRegistry: Test pattern matching per category
- StateMachine: Test allowed transitions per state
- EscalationManager: Test escalation queuing and notification
- SessionUpdaters: Test atomic session mutations
- flowOrchestrator: Test message routing and state transitions

## Next Steps (Post-Phase 7)

1. **Migrate botLogic.js** to use new modules (estimated 2-3 hours)
2. **Write integration tests** for state machine + flowOrchestrator
3. **Profile performance** — measure impact of new abstractions
4. **Document API contracts** — JSDoc for exported functions
5. **Create troubleshooting guide** — common errors and fixes

---

**Refactoring completed:** 2026-06-03  
**Lines of code added:** ~1,800 (across 16 modules)  
**Estimated botLogic.js reduction:** 30-40% (after migration)
