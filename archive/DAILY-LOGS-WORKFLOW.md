# 📋 Workflow Diario de Análisis de Logs

## Sistema de Retroalimentación Continua
Cada día subes los logs de producción a la carpeta `logs/`, yo los analizo y te doy comentarios sobre qué mejorar.

---

## 📌 PROCESO DIARIO

### 1. SUBIR LOGS (Tu responsabilidad)
```bash
# Al final del día, sube el archivo de logs más reciente a logs/
# El archivo se llama: logs.XXXXXXXXX.log
# (Se genera automáticamente en Railway)

# Verificar qué archivo es el más reciente:
ls -lah logs/
```

### 2. ANALIZAR LOGS (Mi responsabilidad)
```bash
# Ejecutar el analizador automático
node src/analyze-logs-daily.js

# Esto genera un reporte con:
# ✅ Estadísticas de conversaciones
# 🐛 Bugs detectados automáticamente
# 💡 Recomendaciones de mejora
```

### 3. REVISIÓN Y COMENTARIOS (Mi responsabilidad)
Te doy un reporte detallado con:
- **Conversaciones exitosas** (✅ clientes que compraron)
- **Bugs encontrados** (🔴 críticos, 🟡 menores)
- **Mejoras sugeridas** (💡 próxima semana)
- **Patrones observados** (tendencias, errores recurrentes)

### 4. APLICAR FIXES (Mi responsabilidad)
- Bugs críticos → **Arreglar el mismo día**
- Bugs menores → **Agendar para próxima semana**
- Mejoras → **Priorizar por impacto**

---

## 📊 QUÉ ANALIZO CADA DÍA

### Estadísticas
- Número de conversaciones
- Promedio de mensajes por conversación
- Duración promedio
- Tasa de cierre exitoso

### Bugs Detectados Automáticamente
- ✅ limpiarNombre() aceptando preguntas
- ✅ Nombre no actualizado tras corrección
- ✅ Escalaciones sin confirmación
- ✅ CP no validado antes de prometer canal
- ✅ Distribuidores no escalados automáticamente

### Mejoras Sugeridas
- Recomendaciones de Claude
- Flujos incompletos
- Productos recomendados que no se venden
- Preguntas frecuentes sin respuesta

---

## 🔧 FIXES APLICADOS HOY (2026-06-03)

### ✅ Fix 1: limpiarNombre() rechaza preguntas
```
ANTES: "Que precio tiene el vital ovinos?" → Aceptado como apellido
DESPUÉS: Rechazado (palabras clave detectadas)
```

### ✅ Fix 2: Script de análisis automático
```bash
node src/analyze-logs-daily.js
# Genera reporte en 5 segundos
# Detecta bugs automáticamente
# Sugerencias basadas en patrones reales
```

---

## 📅 HORARIO SUGERIDO

| Hora | Actividad | Responsable |
|------|-----------|-------------|
| 6:00 PM | Exportar logs de Railway | Diego |
| 6:05 PM | Subir logs a `/logs/` | Diego |
| 6:10 PM | `node src/analyze-logs-daily.js` | Diego/Claude |
| 6:15 PM | Revisar reporte con comentarios | Claude → Diego |
| 6:30 PM | Aplicar fixes críticos | Claude |
| 6:45 PM | Deploy de fixes (auto en Railway) | Railway |

---

## 💬 EJEMPLO DE REPORTE DIARIO

```
╔════════════════════════════════════════════════════════╗
║       ANÁLISIS DIARIO DE LOGS - 2026-06-03            ║
╚════════════════════════════════════════════════════════╝

📊 ESTADÍSTICAS:
   Conversaciones: 7
   Promedio mensajes/conversación: 12.4
   Total mensajes: 87

🐛 BUGS DETECTADOS:

1. 🔴 CRÍTICO limpiarNombre aceptando preguntas como apellidos
   Ejemplo: Cliente dice "Que precio tiene..." → bot capta como nombre
   ✅ ARREGLADO

2. 🟡 IMPORTANTE CP no validado antes de prometer paquetería
   Ejemplo: Wilfrido recibió "paquetería" sin verificar cobertura
   ⏳ AGENDAR PRÓXIMA SEMANA

💡 RECOMENDACIONES:

- Agregar confirmación de cobertura en Edomex
- Permitir corrección de nombre en estado active
- Escalar automáticamente distribuidores detectados
```

---

## 🚀 HERRAMIENTAS DISPONIBLES

```bash
# Ver último log
ls -lah logs/ | tail -1

# Analizar logs
node src/analyze-logs-daily.js

# Ver resultados de tests (si hay)
node src/tests.js

# Ver profiling
node src/production-analysis.js
```

---

## 📝 NOTAS

- **Los logs se guardan automáticamente en Railway**
- **El script analiza el archivo más reciente**
- **Bugs críticos se arreglan el mismo día**
- **Mejoras se agrupan por semana**
- **El sistema está diseñado para iteración rápida**

---

**Próximo análisis:** Mañana a las 6:10 PM (o cuando subes los logs)
