# 📊 Daily Analysis Reports

Carpeta centralizada para análisis diarios de logs del bot Llabana.

---

## 📋 Estructura

```
daily-analysis/
├── README.md (este archivo)
├── ANALYSIS-YYYY-MM-DD.txt
├── ANALYSIS-YYYY-MM-DD.txt
└── [más análisis...]
```

---

## 🔄 Workflow Diario

### 1️⃣ Yo genero el análisis
```bash
node src/analyze-logs-daily.js > daily-analysis/ANALYSIS-$(date +%Y-%m-%d).txt
```

### 2️⃣ Tú subes a Claude.ai
- Abre: **https://claude.ai/code**
- Sube el archivo `ANALYSIS-YYYY-MM-DD.txt` más reciente
- Comenta/aprueba/ajusta las recomendaciones
- Envía el chat con comentarios

### 3️⃣ Yo implemento los cambios
- Leo tus comentarios
- Implemento solo lo aprobado
- Deploy automático en Railway
- Monitoreo en próximos logs

---

## 📌 Campos Importantes de Cada Análisis

Cada archivo contiene:

| Campo | Propósito |
|-------|-----------|
| **PERÍODO ANALIZADO** | Timestamp inicio/fin (para no repetir mañana) |
| **ESTADÍSTICAS** | # conversaciones, mensajes, eventos |
| **BUGS DETECTADOS** | Lo que encontré + estado (fixed/pending) |
| **RECOMENDACIONES** | Categorizadas por criticidad |
| **TIMESTAMP PRÓXIMO** | Dónde comenzar mañana (copiar exacto) |

---

## 🎯 Próximos Análisis

Cada día, el nuevo análisis comenzará desde el timestamp final del anterior:

```
Hoy:     2026-06-02T15:03:32Z ─→ 2026-06-03T14:33:10Z
Mañana:  2026-06-03T14:33:10Z ─→ [nuevo fin]
```

---

## ✅ Checklist para Mañana

- [ ] Leer ANALYSIS-2026-06-03.txt
- [ ] Subirlo a Claude.ai
- [ ] Aprobar/comentar recomendaciones
- [ ] Retornar comentarios
- [ ] Yo implemento + deploy

---

Última actualización: 2026-06-03
