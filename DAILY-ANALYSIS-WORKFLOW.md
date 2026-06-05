# 📊 Workflow de Análisis Diario de Logs

## ¿Por qué?

Necesitas:
- **Cobertura completa**: No truncar logs, analizar TODO
- **Continuidad clara**: Saber exactamente dónde termina un análisis y dónde comienza el siguiente
- **Reproducibilidad**: Un formato consistente que siempre muestre los límites de cada período
- **Visibilidad**: Detectar bugs antes de que afecten producción

---

## Proceso Diario

### 1️⃣ Mañana (después de que Wig revisó escalaciones)

Ejecuta los análisis:

```bash
# Análisis 1: Resumen por día con estadísticas (rápido)
node src/analyze-logs-complete.js

# Análisis 2: Detallado con problemas detectados (completo)
node src/analyze-logs-detailed.js
```

**Ambos se guardan en**: `daily-analysis/ANALYSIS-*.txt`

### 2️⃣ Lee los reportes

**Para un overview rápido**:
```bash
cat daily-analysis/ANALYSIS-COMPLETE-2026-06-06.txt
```

**Para análisis profundo** (buscar bugs):
```bash
cat daily-analysis/ANALYSIS-DETAILED-2026-06-06.txt
```

### 3️⃣ Busca problemas

En el reporte DETAILED, busca secciones como:

```
🔴 PROBLEMAS DETECTADOS EN 2026-06-06
─────────────────────────────────────
   [NOMBRE_INVALIDO] +5215546680886
   → Bot pidió confirmar nombre sospechoso: "distribuidor"
```

### 4️⃣ Si hay bugs

**Paso 1**: Localiza el bug exacto en el log

```bash
# Busca por teléfono en el log original
cat logs/logs.*.log | grep "5215546680886"
```

**Paso 2**: Obtén el contexto exacto de botLogic.js

```bash
# Busca el patrón que causó el problema
grep -n "Tu nombre es" src/botLogic.js
```

**Paso 3**: Aplica el fix **quirúrgico** 
(Cambias SOLO las líneas necesarias, no el archivo completo)

**Paso 4**: Verifica el deploy

```bash
# Espera 60s y luego
curl https://llabana-bot-production.up.railway.app/health | jq .commit
```

---

## 📋 Estructura del Reporte

### ANALYSIS-COMPLETE
```
┌─ DÍA: 2026-06-06 ──────────────┐
│ ⏰ PERÍODO
│    Inicio:  2026-06-06T08:15:32Z
│    Fin:     2026-06-06T23:45:10Z
│
│ 📊 ESTADÍSTICAS
│    Líneas:        245
│    Conversaciones: 5
│    Escalaciones:   1
│
│ 📱 CONVERSACIONES
│    ✅ +5215546680886: 10 mensajes
│    🚨 +5219212652984: 3 mensajes
│
✂️  ─────────────────────────────────
   CORTE DE CONTINUIDAD
   ➜ PRÓXIMO ANÁLISIS DESDE: 2026-06-06T23:45:10Z
```

### ANALYSIS-DETAILED
```
🔴 PROBLEMAS DETECTADOS EN 2026-06-06
─────────────────────────────────────
   [NOMBRE_INVALIDO] +5215546680886
   → Bot pidió confirmar nombre sospechoso: "distribuidor"

   [SALTÓ_NOMBRE] +5219212652984
   → Bot preguntó ubicación sin capturar nombre primero
```

---

## 🎯 Puntos de Corte (Continuidad)

Cada reporte tiene una sección **"PRÓXIMO ANÁLISIS COMENZARÁ DESDE"**

**Ejemplo**:
```
Este análisis cubrió:  2026-06-04T00:00:00Z → 2026-06-05T23:59:59Z
Próximo comenzará:     2026-06-05T23:59:59Z en adelante
```

**Esto garantiza**:
- ✅ NO hay duplicados (no contas 2 veces)
- ✅ NO hay huecos (no saltas líneas)
- ✅ Continuidad perfecta entre días

---

## 🔍 Cómo Leer los Logs Manualmente

Si quieres validar un análisis o investigar un bug:

```bash
# Filtro avanzado (copia este comando)
cat logs/logs.*.log | \
  grep "2026-06-06" | \
  grep -v "ETIMEDOUT\|reconnect\|Redis error" | \
  grep -E "(📨|📤|✅|❌|ESCALACION|ERROR)" | \
  head -50
```

---

## 📝 Checklist Diario

```
[ ] Ejecute los 2 análisis
[ ] Revisé ANALYSIS-DETAILED buscando 🔴 PROBLEMAS
[ ] Si hay bugs, apliqué fix quirúrgico en botLogic.js
[ ] Hice git push (auto-deploy en 60s)
[ ] Verifiqué /health endpoint con nuevo commit
[ ] Guardé punto de corte para mañana (ya está en el reporte)
```

---

## 📌 Ejemplo Real

**Viernes 2026-06-05** → El análisis cubre hasta `15:27:56Z`

```
🏁 FIN DEL PERÍODO
   Próximo análisis COMENZARÁ desde: 2026-06-05T15:27:56Z
```

**Lunes 2026-06-08** → El log nuevo comienza a las `06:00:00Z`

```
VALIDACIÓN:
  ✓ Nuevo log comienza en 2026-06-08T06:00:00Z
  ✓ Anterior terminó en 2026-06-05T15:27:56Z
  ✓ Hay gap de 2.5 días (fin de semana) → NORMAL
  ✓ Sin overlap → sin duplicados
```

---

## 🚀 Automatización Futura

Podrías agregar a un cron diario (por ej, 8am México):

```bash
#!/bin/bash
cd /Users/diegoramirez/llosa-bot
node src/analyze-logs-complete.js >> logs/daily-analysis.log
node src/analyze-logs-detailed.js >> logs/daily-analysis.log
git add daily-analysis/*.txt
git commit -m "daily: analysis for $(date +%Y-%m-%d)" || true
git push
```

---

## Preguntas Frecuentes

**P: ¿Por qué dos scripts?**
R: `complete` es rápido para overview. `detailed` tarda más pero detecta bugs. Ejecuta ambos.

**P: ¿El reporte es privado?**
R: Se guardan en `daily-analysis/` y suben a git. Si incluyen datos sensibles, agrega a `.gitignore`.

**P: ¿Qué pasa si los logs rotaron?**
R: Los scripts siempre toman el archivo MÁS RECIENTE. Railway rota cada 1GB. Incluye el timestamp exacto de inicio/fin en el reporte.

**P: ¿Cómo sé si un problema es real?**
R: Busca la línea exacta en el log original. Si ves:
```
📨 [whatsapp:+5215546680886]: distribuidor
📤 [whatsapp:+5215546680886]: Tu nombre es distribuidor?
```
Entonces SÍ, el bot metió la pata.

---

## Resumen

| Acción | Comando | Tiempo | Salida |
|--------|---------|--------|--------|
| Análisis rápido | `node src/analyze-logs-complete.js` | <5s | ANALYSIS-COMPLETE |
| Análisis completo | `node src/analyze-logs-detailed.js` | <10s | ANALYSIS-DETAILED |
| Guardar reporte | Automático | - | `daily-analysis/` |
| Punto de corte | En el reporte | - | "PRÓXIMO ANÁLISIS DESDE" |

👉 **Mañana, ejecuta ambos scripts y revisa el ANALYSIS-DETAILED buscando 🔴**
