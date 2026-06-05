#!/usr/bin/env node
/**
 * Análisis Completo de Logs - Por día
 * Lee log completo, divide por días, genera reporte detallado
 * con markup claro de puntos de corte para continuidad
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

/**
 * Lee el archivo de logs más reciente
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

/**
 * Extrae timestamp de una línea de log
 */
function extractTimestamp(line) {
  const match = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : null;
}

/**
 * Extrae fecha en formato YYYY-MM-DD
 */
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
 * Extrae conversaciones de líneas
 */
function extractConversations(lines) {
  const conversations = {};

  for (const line of lines) {
    // Mensajes de usuario
    const userMatch = line.match(/📨\s+\[whatsapp:(\+52\d+)\]:\s*(.+)/);
    if (userMatch) {
      const phone = userMatch[1];
      const message = userMatch[2];
      if (!conversations[phone]) {
        conversations[phone] = { messages: [] };
      }
      conversations[phone].messages.push({
        type: 'user',
        text: message.substring(0, 100),
        raw: line
      });
    }

    // Mensajes de bot
    const botMatch = line.match(/📤\s+\[whatsapp:(\+52\d+)\]:\s*(.+)/);
    if (botMatch) {
      const phone = botMatch[1];
      const message = botMatch[2];
      if (!conversations[phone]) {
        conversations[phone] = { messages: [] };
      }
      conversations[phone].messages.push({
        type: 'bot',
        text: message.substring(0, 100),
        raw: line
      });
    }

    // Escalaciones
    if (line.includes('[DIAGNOSTICO:ESCALACION]') || line.includes('escal')) {
      const phoneMatch = line.match(/whatsapp:(\+52\d+)/);
      if (phoneMatch) {
        const phone = phoneMatch[1];
        if (!conversations[phone]) {
          conversations[phone] = { messages: [] };
        }
        conversations[phone].escalation = true;
      }
    }
  }

  return conversations;
}

/**
 * Genera reporte completo
 */
function generateCompleteReport(logFile, logContent) {
  const dayMap = divideByDay(logContent);
  const dates = Object.keys(dayMap).sort();
  const date = new Date().toISOString().split('T')[0];

  let report = `╔════════════════════════════════════════════════════════════════════════════════╗
║                      ANÁLISIS COMPLETO DE LOGS POR DÍA                        ║
║                         Período: ${dates[0]} a ${dates[dates.length - 1]}                           ║
╚════════════════════════════════════════════════════════════════════════════════╝

📋 RESUMEN GENERAL
─────────────────────────────────────────────────────────────────────────────────
📁 Archivo: ${path.basename(logFile)}
📅 Fechas: ${dates[0]} a ${dates[dates.length - 1]}
📊 Total líneas: ${logContent.split('\n').length}
📍 Total días analizados: ${dates.length}

🔍 PUNTOS DE CORTE PARA CONTINUIDAD
─────────────────────────────────────────────────────────────────────────────────
INICIO: ${dates[0]}T00:00:00Z
FIN:    ${dates[dates.length - 1]}T23:59:59Z

PRÓXIMO ANÁLISIS COMENZARÁ DESDE:
→ ${dates[dates.length - 1]}T23:59:59Z en adelante

═════════════════════════════════════════════════════════════════════════════════\n\n`;

  // Por cada día
  for (const date of dates) {
    const dayLines = dayMap[date];
    const conversations = extractConversations(dayLines);
    const conversationCount = Object.keys(conversations).length;

    // Timestamps del día
    const timestamps = dayLines
      .map(l => extractTimestamp(l))
      .filter(Boolean)
      .sort();
    const firstTime = timestamps[0] || '00:00:00';
    const lastTime = timestamps[timestamps.length - 1] || '23:59:59';

    report += `┌─ DÍA: ${date} ─────────────────────────────────────────────────────────────┐
│
│ ⏰ PERÍODO DEL DÍA
│    Inicio:  ${firstTime}Z
│    Fin:     ${lastTime}Z
│
│ 📊 ESTADÍSTICAS
│    Líneas de log:        ${dayLines.length}
│    Conversaciones:       ${conversationCount}
│    Mensajes procesados:  ${dayLines.filter(l => l.includes('📨') || l.includes('📤')).length}
│    Escalaciones:         ${dayLines.filter(l => l.includes('ESCALACION')).length}
│
│ 🔄 CONVERSACIONES DEL DÍA\n`;

    for (const [phone, data] of Object.entries(conversations)) {
      const messageCount = data.messages.length;
      const hasEscalation = data.escalation ? '🚨' : '';
      report += `│    ${hasEscalation} ${phone}: ${messageCount} mensajes\n`;
    }

    report += `│
└───────────────────────────────────────────────────────────────────────────────┘

`;

    // Marca de continuidad
    if (date !== dates[dates.length - 1]) {
      report += `✂️  CORTE DE CONTINUIDAD
   El próximo análisis COMENZARÁ desde: ${lastTime}Z
   ═══════════════════════════════════════════════════════════════════════════════\n\n`;
    } else {
      report += `🏁 FIN DEL PERÍODO
   Próximo análisis COMENZARÁ desde: ${lastTime}Z
   ═══════════════════════════════════════════════════════════════════════════════\n\n`;
    }
  }

  // Resumen final
  report += `📝 RESUMEN FINAL
─────────────────────────────────────────────────────────────────────────────────
Total de días:           ${dates.length}
Rango de fechas:        ${dates[0]} a ${dates[dates.length - 1]}
Total de conversaciones: ${Object.keys(extractConversations(logContent.split('\n'))).length}
Estado del sistema:      ✅ ANALIZADO COMPLETAMENTE

📌 IMPORTANTE PARA EL PRÓXIMO ANÁLISIS
─────────────────────────────────────────────────────────────────────────────────
Usar como punto de inicio: ${dates[dates.length - 1]}T23:59:59Z

Esto asegura que NO haya:
  ✓ Duplicados de análisis
  ✓ Saltos de información
  ✓ Huecos en la cobertura

═════════════════════════════════════════════════════════════════════════════════

Generado: ${new Date().toISOString()}
`;

  return report;
}

// ────────────────────────────────────────────────────────────────────────────

const logFile = getLatestLogFile();
const content = fs.readFileSync(logFile, 'utf-8');
const report = generateCompleteReport(logFile, content);

console.log(report);

// Guardar reporte
const reportPath = path.join(__dirname, '..', 'daily-analysis', `ANALYSIS-COMPLETE-${new Date().toISOString().split('T')[0]}.txt`);
fs.writeFileSync(reportPath, report);
console.log(`\n📁 Reporte guardado en: ${reportPath}`);
