# CLAUDE.md — Llabana Bot
# Lee este archivo al inicio de cada sesión antes de tocar cualquier código.

## QUÉ ES ESTE PROYECTO

Chatbot de WhatsApp para **Comercializadora Llabana** — empresa mexicana de alimento
balanceado (Purina, Semillina), 36 sucursales en 7 estados, CEDIS en Ecatepec.

- **WhatsApp:** Twilio (+17623490579)
- **IA:** Claude API Sonnet 4.6 (claude-sonnet-4-6)
- **CRM:** Google Sheets (ID: 1j1kgEL7BhP09rZy7bYKC0ay6rNPe_-8BnAwx5kzFtaM)
- **Sesiones:** Redis TTL 30h + fallback memoria
- **Deploy:** Railway (auto-deploy en cada push a main)
- **Dashboard:** https://llabana-bot-production.up.railway.app/dashboard/
- **Asesor humano (Wig):** +5215648076361

---

## ESTRUCTURA DEL PROYECTO

32 archivos organizados por categoría:

```
llosa-bot/
├── src/
│   ├─ CORE (Servicios principales)
│   │  ├── index.js                    — Express, rutas, cron follow-ups, health check
│   │  ├── botLogic.js                 — (~2387 líneas) flujo conversacional principal
│   │  ├── claudeService.js            — Claude API integration + system prompt
│   │  ├── sheetsService.js            — Google Sheets CRUD + caching
│   │  ├── sessionManager.js           — Redis TTL 30h + fallback memoria
│   │  └── twilioService.js            — WhatsApp message dispatch
│   │
│   ├─ HANDLERS (Webhooks y administración)
│   │  ├── webhookHandler.js           — Twilio webhook, debounce 1.5s
│   │  ├── wigAdminHandler.js          — Comandos /reparto /sucursal /nocontesta /atendido /pendientes
│   │  └── shopifyWebhookHandler.js    — Webhooks Shopify
│   │
│   ├─ SERVICES (Lógica de negocio)
│   │  ├── followUpService.js          — Follow-ups A (2h activo) y C (23h escalado)
│   │  ├── transcriptService.js        — Pestaña 5 Sheets, truncamiento 48k chars
│   │  ├── horarioService.js           — L-V 8am-5pm, Sáb 9am-2pm
│   │  ├── knowledgeService.js         — Catálogo desde pestaña 7 Sheets (cache 5 min)
│   │  └── colaEscalaciones.js         — Cola Redis para escalaciones fuera de horario
│   │
│   ├─ UTILS (Utilidades y validadores)
│   │  ├── constants.js                — FLOW_STATES enum, magic strings centralizados
│   │  ├── validators.js               — CPValidator, PhoneValidator
│   │  ├── logger.js                   — Logging unificado con prefijos emoji
│   │  ├── patternRegistry.js          — 100+ regex patterns centralizados
│   │  ├── messageUtils.js             — cleanBotResponse, getFirstName, etc
│   │  ├── zoneChecker.js              — Detección de zona y viabilidad de entrega
│   │  └── customerRegistry.js         — Registro y actualización de clientes
│   │
│   ├─ HANDLERS DE ESTADO (Estado activo)
│   │  ├── activeStateHandlers.js      — detectCP, handleDistributorFlow, etc
│   │  └── stateHelpers.js             — validateName, isGoodbye, etc
│   │
│   ├─ SERVICE LAYER (Orquestación de servicios)
│   │  ├── claudeWrappers.js           — Funciones contextuales de Claude
│   │  ├── escalationManager.js        — Escalaciones a Wig, notificaciones
│   │  └── sessionUpdaters.js          — Actualizaciones atómicas de sesión
│   │
│   ├─ CONFIGURACIÓN (Config y esquemas)
│   │  ├── config.js                   — Configuración centralizada
│   │  └── sheetSchemas.js             — Esquemas de las 7 pestañas Sheets
│   │
│   ├─ STATE MACHINE (Control de flujo)
│   │  ├── stateMachine.js             — Validación de transiciones de estado
│   │  └── flowOrchestrator.js         — Coordinación del flujo de mensajes
│   │
│   ├─ DOCUMENTACIÓN
│   │  ├── ARCHITECTURE.md             — Descripción completa de módulos
│   │  ├── MODULE_GUIDE.md             — Guía de importación y patrones
│   │  └── MIGRATION_PROGRESS.md       — Progreso de migración de botLogic.js
│   │
│   ├─ CONFIGURACIÓN DEL PROYECTO
│   │  ├── .gitignore
│   │  ├── package.json
│   │  └── CLAUDE.md (este archivo)
│   │
├── public/
│   └── index.html                     — Dashboard de conversaciones
│
├── logs/                              — Logs de Railway (NO se suben a git)
│   └── .gitkeep
│
└── [Otros archivos de config]
    ├── .railwayrc / railway.json      — Configuración Railway
    └── [variables de entorno]
```

**Total: 32 archivos** (10 servicios originales + 16 módulos nuevos + 3 docs + 3 otros)

---

## FLUJO CONVERSACIONAL — ESTADOS (12)

```
asking_mexico           → ¿Estás en México?
asking_entrega_mx       → ¿Tienes dirección en México? (números extranjeros)
asking_name             → ¿Con quién tengo el gusto? (pide nombre + apellido)
confirming_name         → ¿Tu nombre es X?
active                  → Conversación libre con Claude
asking_cp_before_escalation → ¿Cuál es tu CP?
confirming_escalation   → Confirmar escalación a Wig
confirming_reset        → ¿Nueva consulta?
waiting_for_wig         → Esperando asesor
escalated               → Escalado fuera de horario
out_of_coverage         → Fuera de México
```

## FLUJO PRINCIPAL

```
Mensaje → ¿número conocido en Sheets? 
  SÍ → saludar por nombre → active
  NO → asking_mexico
       → asking_name (nombre + apellido siempre)
       → confirming_name
       → clasificarIntencion():
           Proveedor   → flujo 4 pasos → Wig (NO registra Sheets)
           Distribuidor→ flujo 3 pasos → Wig (SÍ registra Sheets)
           Queja       → Wig urgente sin CP
           Corporativo → Wig sin CP
           Compra      → pedir CP → canal:
               CDMX (01000-16999)  → Wig
               Edomex (50000-57999)→ Wig (asesor confirma cobertura)
               Provincia ≤10 bultos → paquetería, cierra solo
               Provincia 11-499    → cierre honesto + alternativa camión
               500+ / 12+ tons     → Wig
```

---

## REGLAS CRÍTICAS — NUNCA ROMPER

### Nombres
- Siempre pedir nombre + apellido. Nunca aceptar solo una palabra.
- `limpiarNombre` rechaza: productos, ciudades, pronombres, verbos de acción, frases >4 palabras
- Confirmar nombre completo antes de continuar

### CP y canal
- NUNCA hablar de canal antes de tener el CP
- NUNCA prometer paquetería para cantidades 11-499 bultos sin saber el CP
- Edomex: NO decir "entrega directa garantizada" — decir "asesor confirma cobertura"

### Confidencialidad sucursales
- NUNCA decir "nuestras sucursales" ni dar listados
- NUNCA decir cuántas sucursales hay ni en qué estados
- Solo confirmar si hay cobertura en ciudad específica (busca en Sheets silenciosamente)
- Si quiere pasar a recoger → escalar a Wig para dar dirección

### Precios
- Precio fijo, sin descuentos ni excepciones
- No decir formas de pago — "se ven al pagar en la tienda"

### Proveedores (quien quiere VENDERLE a Llabana)
- NO registrar en Sheets
- Recolectar: producto → empresa → puesto → contacto → notificar Wig
- Patterns en español e inglés (manufacturer, supplier, fabricante, etc.)

### Distribuidores (quien quiere REVENDER productos de Llabana)
- SÍ registrar en Sheets
- Recolectar: ciudad → tipo de negocio → volumen → notificar Wig

---

## LO QUE RESUELVE SOLO (SIN WIG)

- Existencia de producto ("si aparece el botón, hay stock")
- Facturación ("sí, al pagar en la tienda")
- Tiempo de entrega por zona
- Precios del catálogo
- Números de guía de rastreo
- Devoluciones (pide fotos primero)
- Cantidad inviable → cierre honesto

## LO QUE ESCALA A WIG

- CDMX/Edomex (cualquier cantidad)
- 500+ bultos / camión completo
- Quejas de pedido activo
- Frustración extrema (renotifica CADA mensaje)
- Solicitud de asesor humano
- Querer recoger en CEDIS
- Distribuidor potencial
- Proveedor potencial
- Solicitud corporativa (compras/marketing/ventas)

---

## SISTEMA DE ESCALACIONES

- **Dentro de horario:** notifica a Wig inmediato
- **Urgente** (🚨🚨🚨): frustración extrema, enojo, sin atención 23h
- **Fuera de horario:** cola Redis → Wig corre `/pendientes` al llegar
- **escalacionPendiente:** cliente retoma en horario → notifica automáticamente
- **Renotificación:** cada mensaje de frustración reenvía alerta a Wig

---

## FOLLOW-UPS AUTOMÁTICOS

- **Follow-up A:** cliente `active` 2h inactivo → mensaje personalizado → solo hasta 7pm
- **Follow-up C:** cliente `waiting_for_wig`/`escalated` 23h → pregunta si fue atendido
- Si dice NO → reescalación urgente a Wig

---

## COMANDOS WIG (+5215648076361)

```
/pendientes              → Ver escalaciones fuera de horario
/reparto +521XXXXXXXXXX  → Marcar como Comprador + tag Reparto
/sucursal +521... Nombre → Redirigir a sucursal
/nocontesta +521...      → Marcar No Contestó
/atendido +521...        → Limpiar sesión y marcar atendido
/ayuda                   → Ver lista
```

---

## GOOGLE SHEETS — PESTAÑAS

```
1 Base Maestra      — ~3,950+ contactos
2 Sucursales        — 36 sucursales (busca aquí cuando cliente pregunta por ciudad)
4 Seguimientos 24h  — Follow-ups registrados
5 Transcripciones   — Historial conversaciones (límite 48k chars por celda)
6 FAQs              — Base de conocimiento
7 Productos         — Catálogo 155 productos con precios y links
```

---

## CÓMO ANALIZAR LOS LOGS

Los logs están en `logs/` — el archivo más reciente es el que hay que analizar.

### Comando de filtrado:
```bash
cat logs/[archivo].log | grep "2026-06-XX" | \
  grep -v "ETIMEDOUT\|Redis error\|reconnect\|FOLLOWUP-C-DEBUG" | \
  grep -E "(📨|📤|✅|❌|DIAGNOSTICO|FOLLOWUP|orders/paid|customers/create|Error|escala|registrado)"
```

### Qué buscar:
| Señal en el log | Problema probable |
|-----------------|-------------------|
| `"¿tu nombre es *[frase rara]*?"` | limpiarNombre no rechazó la frase |
| `DIAGNOSTICO:ESCALACION` + respuesta normal | Claude ignoró la instrucción de escalar |
| `"Te llegamos por paquetería"` sin CP previo | Bot prometió canal sin saber ubicación |
| `[FOLLOWUP-A] nombre: [nombre_raro]` | Nombre mal capturado llegó al follow-up |
| `Revisando X sesiones \| Y escaladas` con Y > 6 | Wig no está usando `/atendido` |
| `Redis error: ETIMEDOUT` | Redis caído, bot en modo fallback |

### Formato de reporte:
```
## 🟢 Funcionando bien
(casos exitosos con evidencia)

## 🔴 Bugs detectados
(texto exacto del log + causa + fix)

## Fix prioritario
(prompt quirúrgico listo para aplicar)
```

---

## CÓMO APLICAR FIXES

Los fixes deben ser QUIRÚRGICOS — no leer archivos completos:

```
En src/[archivo].js, buscar "[texto único para ubicar]".
Reemplazar:
  [código actual exacto]
Por:
  [código nuevo]

git add src/[archivo].js
git commit -m "fix: descripción breve"
git push
```

Después de cada push, Railway hace auto-deploy en ~60 segundos.
Verificar en: https://llabana-bot-production.up.railway.app/health

---


## APRENDIZAJES IMPORTANTES

- **Shopify webhooks:** customers/update llega casi vacío → siempre llamar Admin API
- **Twilio México:** formato correcto es `whatsapp:+521XXXXXXXXXX` (521, no solo 52)
- **Redis Railway:** puede caer sin aviso → fallback memoria es esencial
- **limpiarNombre:** rechaza productos, ciudades, pronombres, verbos, frases >4 palabras
- **isDistribuidor:** excluye preguntas de cobertura ("¿tienen distribuidor en X?")
- **Edomex:** no todo tiene reparto → asesor confirma cobertura, no prometer entrega directa
- **intentPrevio:** si parece ubicación, descartarlo antes de clasificarIntencion
- **Proveedores extranjeros:** PROVEEDOR_PATTERNS incluye inglés (manufacturer, supplier, etc.)
- **"Su"/"Sus":** en México se usa como "Sí" → incluido en esConfirmacion

