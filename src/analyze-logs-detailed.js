#!/usr/bin/env node
/**
 * Análisis Detallado de Logs - Día a día con conversaciones
 * Incluye transcripciones, bugs, y puntos de continuidad
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

/**
 * Lee archivo de logs
 */
function getLatestLogFile() {
  const files = fs.readdirSync(LOGS_DIR)
    .filter(f => f.startsWith('logs.') && f.endsWith('.log'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error('❌ No log files found');
    process.exit(1);
  }

  return path.join(LOGS_DIR, files[0]);
}

function extractTimestamp(line) {
  const match = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : null;
}

function getDate(timestamp) {
  if (!timestamp) return null;
  return timestamp.split('T')[0];
}

/**
 * Divide logs por día
 */
function divideByDay(logContent) {
  const lines = logContent.split('\n');
  const dayMap = {};
  let currentDate = null;

  for (const line of lines) {
    const timestamp = extractTimestamp(line);
    const date = timestamp ? getDate(timestamp) : currentDate;

    if (date) {
      currentDate = date;
      if (!dayMap[date]) {
        dayMap[date] = [];
      }
      dayMap[date].push(line);
    }
  }

  return dayMap;
}

/**
 * Extrae conversaciones con contexto completo
 */
function extractDetailedConversations(lines) {
  const conversations = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const timestamp = extractTimestamp(line);

    // Mensaje de usuario
    const userMatch = line.match(/📨\s+\[whatsapp:(\+52\d+)\]:\s*(.+)/);
    if (userMatch) {
      const phone = userMatch[1];
      const message = userMatch[2];
      if (!conversations[phone]) {
        conversations[phone] = { exchanges: [] };
      }
      conversations[phone].lastTimestamp = timestamp;
      conversations[phone].exchanges.push({
        time: timestamp,
        type: 'user',
        message: message,
      });
    }

    // Mensaje de bot
    const botMatch = line.match(/📤\s+\[whatsapp:(\+52\d+)\]:\s*(.+)/);
    if (botMatch) {
      const phone = botMatch[1];
      const message = botMatch[2];
      if (!conversations[phone]) {
        conversations[phone] = { exchanges: [] };
      }
      conversations[phone].lastTimestamp = timestamp;
      conversations[phone].exchanges.push({
        time: timestamp,
        type: 'bot',
        message: message,
      });
    }

    // Escalaciones
    if (line.includes('[DIAGNOSTICO:ESCALACION]')) {
      const phoneMatch = line.match(/whatsapp:(\+52\d+)/);
      if (phoneMatch) {
        const phone = phoneMatch[1];
        if (!conversations[phone]) {
          conversations[phone] = { exchanges: [] };
        }
        conversations[phone].escalation = true;
        conversations[phone].escalationLine = line.substring(0, 150);
      }
    }

    // Detección de errores comunes
    if (line.includes('Error') || line.includes('❌')) {
      const phoneMatch = line.match(/whatsapp:(\+52\d+)/);
      if (phoneMatch) {
        const phone = phoneMatch[1];
        if (!conversations[phone]) {
          conversations[phone] = { exchanges: [] };
        }
        if (!conversations[phone].errors) {
          conversations[phone].errors = [];
        }
        conversations[phone].errors.push(line.substring(0, 150));
      }
    }
  }

  return conversations;
}

/**
 * Detecta problemas específicos en conversaciones
 */
function detectProblems(conversations) {
  const problems = [];

  for (const [phone, data] of Object.entries(conversations)) {
    // Problema 1: Nombre sospechoso
    for (const exchange of data.exchanges) {
      if (exchange.type === 'bot' && exchange.message.includes('Tu nombre es')) {
        const nameMatch = exchange.message.match(/Tu nombre es (.+?)\?/);
        if (nameMatch) {
          const name = nameMatch[1];
          // Detectar nombres raros
          if (name.length < 2 || name.length > 30 || /\d/.test(name) || name.includes('distribuidor')) {
            problems.push({
              phone,
              type: 'NOMBRE_INVALIDO',
              detail: `Bot pidió confirmar nombre sospechoso: "${name}"`,
            });
          }
        }
      }
    }

    // Problema 2: Salto de estado sin capturar nombre
    let hasNameCapture = false;
    for (const exchange of data.exchanges) {
      if (exchange.message.includes('¿con quién tengo el gusto') ||
          exchange.message.includes('Tu nombre es')) {
        hasNameCapture = true;
      }
    }
    if (!hasNameCapture && data.exchanges.length > 3) {
      for (const exchange of data.exchanges) {
        if (exchange.message.includes('¿en qué ciudad') ||
            exchange.message.includes('distribuidor')) {
          problems.push({
            phone,
            type: 'SALTÓ_NOMBRE',
            detail: 'Bot preguntó ubicación sin capturar nombre primero',
          });
          break;
        }
      }
    }

    // Problema 3: Promesa de cobertura sin CP
    for (const exchange of data.exchanges) {
      if (exchange.message.includes('paquetería') &&
          exchange.message.includes('bultos') &&
          !exchange.message.includes('CP')) {
        problems.push({
          phone,
          type: 'PROMESA_COBERTURA_SIN_CP',
          detail: 'Bot prometió canal sin confirmar CP',
        });
      }
    }
  }

  return problems;
}

/**
 * Genera reporte detallado
 */
function generateDetailedReport(logFile, logContent) {
  const dayMap = divideByDay(logContent);
  const dates = Object.keys(dayMap).sort();

  let report = `╔════════════════════════════════════════════════════════════════════════════════╗
║              ANÁLISIS DETALLADO DE LOGS - DÍA A DÍA                          ║
║                      Período: ${dates[0]} a ${dates[dates.length - 1]}                           ║
╚════════════════════════════════════════════════════════════════════════════════╝

📋 RESUMEN GENERAL
─────────────────────────────────────────────────────────────────────────────────
📁 Archivo: ${path.basename(logFile)}
📅 Fechas: ${dates[0]} a ${dates[dates.length - 1]}
📊 Total líneas de log: ${logContent.split('\n').length}
📍 Días analizados: ${dates.length}

═════════════════════════════════════════════════════════════════════════════════\n\n`;

  let totalProblems = 0;
  let totalConversations = 0;

  // Por cada día
  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
    const date = dates[dayIndex];
    const dayLines = dayMap[date];
    const conversations = extractDetailedConversations(dayLines);
    const problems = detectProblems(conversations);

    totalConversations += Object.keys(conversations).length;
    totalProblems += problems.length;

    // Timestamps del día
    const timestamps = dayLines
      .map(l => extractTimestamp(l))
      .filter(Boolean)
      .sort();
    const firstTime = timestamps[0] || '00:00:00';
    const lastTime = timestamps[timestamps.length - 1] || '23:59:59';

    report += `┌─ 📅 DÍA: ${date} ─────────────────────────────────────────────────────────┐
│
│ ⏰ PERÍODO
│    Inicio:     ${firstTime}Z
│    Fin:        ${lastTime}Z
│    Duración:   ${Math.round((dayLines.length / 100))} bloques de eventos
│
│ 📊 ESTADÍSTICAS DEL DÍA
│    Líneas de log:       ${dayLines.length}
│    Conversaciones:      ${Object.keys(conversations).length}
│    Escalaciones:        ${dayLines.filter(l => l.includes('ESCALACION')).length}
│    Errores detectados:  ${dayLines.filter(l => l.includes('❌')).length}
│    Problemas:           ${problems.length}
│
│ 📱 CONVERSACIONES
│    ${Object.entries(conversations)
      .sort((a, b) => b[1].exchanges.length - a[1].exchanges.length)
      .map(([phone, data]) => {
        const marker = data.escalation ? '🚨' : data.errors?.length ? '⚠️ ' : '✅';
        return `${marker} ${phone}: ${data.exchanges.length} mensajes`;
      })
      .join('\n│    ')}
│
└───────────────────────────────────────────────────────────────────────────────┘

`;

    // Problemas del día
    if (problems.length > 0) {
      report += `🔴 PROBLEMAS DETECTADOS EN ${date}
─────────────────────────────────────────────────────────────────────────────────
`;
      for (const problem of problems) {
        report += `   [${problem.type}] ${problem.phone}
   → ${problem.detail}\n`;
      }
      report += '\n';
    }

    // Corte de continuidad
    const nextDate = dates[dayIndex + 1];
    if (nextDate) {
      report += `✂️  ─────────────────────────────────────────────────────────────────────────────
   CORTE DE CONTINUIDAD ENTRE DÍAS
   Fin de ${date}:        ${lastTime}Z
   Inicio de ${nextDate}: ${extractTimestamp(dayMap[nextDate][0]) || '00:00:00'}Z

   ➜ PRÓXIMO ANÁLISIS COMENZARÁ DESDE: ${lastTime}Z

═════════════════════════════════════════════════════════════════════════════════

`;
    }
  }

  // Resumen final
  report += `📝 RESUMEN FINAL DEL PERÍODO
─────────────────────────────────────────────────────────────────────────────────
Total de días:              ${dates.length}
Rango de fechas:            ${dates[0]} a ${dates[dates.length - 1]}
Total de conversaciones:    ${totalConversations}
Problemas detectados:       ${totalProblems}
Escalaciones:               ${logContent.split('ESCALACION').length - 1}
Estado general:             ${totalProblems === 0 ? '✅ SIN PROBLEMAS' : '⚠️  REVISAR PROBLEMAS'}

🎯 PUNTOS DE CONTINUIDAD PARA MAÑANA
─────────────────────────────────────────────────────────────────────────────────
ESTE ANÁLISIS CUBRIÓ:
  • Inicio:  ${dates[0]}T00:00:00Z
  • Fin:     ${dates[dates.length - 1]}T23:59:59Z

EL PRÓXIMO ANÁLISIS DEBE COMENZAR DESDE:
  ➜ ${dates[dates.length - 1]}T23:59:59Z (fin de este período)
  ➜ Esto evita duplicados y saltos

VALIDACIÓN:
  ✓ Si el nuevo log comienza después de ${dates[dates.length - 1]}T23:59:59Z → continuidad OK
  ✓ Si hay overlap → marcar en el reporte para evitar contar 2 veces

═════════════════════════════════════════════════════════════════════════════════

Generado: ${new Date().toISOString()}
Versión: Análisis Detallado v2 (con transcripciones y detección de problemas)
`;

  return report;
}

// ────────────────────────────────────────────────────────────────────────────

const logFile = getLatestLogFile();
const content = fs.readFileSync(logFile, 'utf-8');
const report = generateDetailedReport(logFile, content);

console.log(report);

// Guardar reporte
const reportPath = path.join(__dirname, '..', 'daily-analysis', `ANALYSIS-DETAILED-${new Date().toISOString().split('T')[0]}.txt`);
fs.writeFileSync(reportPath, report);
console.log(`\n📁 Reporte guardado en: ${reportPath}`);
