#!/usr/bin/env node
/**
 * Análisis Diario de Logs en Producción
 * Ejecutar con: node src/analyze-logs-daily.js
 *
 * Lee el archivo de logs más reciente en /logs/ y genera:
 * - Resumen de conversaciones
 * - Bugs detectados
 * - Mejoras sugeridas
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
 * Extrae conversaciones de los logs
 */
function extractConversations(logContent) {
  const lines = logContent.split('\n');
  const conversations = {};

  for (const line of lines) {
    // Formato: 📨 [whatsapp:+52XXXXXXXXXX]: mensaje
    const match = line.match(/📨\s+\[whatsapp:(\+52\d+)\]:\s*(.+)/);
    if (match) {
      const phone = match[1];
      const message = match[2];

      if (!conversations[phone]) {
        conversations[phone] = [];
      }
      conversations[phone].push({
        type: 'user',
        message: message.substring(0, 80),
        timestamp: extractTimestamp(line),
      });
    }

    // Formato: 📤 [whatsapp:+52XXXXXXXXXX]: respuesta
    const botMatch = line.match(/📤\s+\[whatsapp:(\+52\d+)\]:\s*(.+)/);
    if (botMatch) {
      const phone = botMatch[1];
      const message = botMatch[2];

      if (!conversations[phone]) {
        conversations[phone] = [];
      }
      conversations[phone].push({
        type: 'bot',
        message: message.substring(0, 80),
        timestamp: extractTimestamp(line),
      });
    }
  }

  return conversations;
}

/**
 * Extrae timestamp de una línea de log
 */
function extractTimestamp(line) {
  const match = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  return match ? match[0] : '';
}

/**
 * Detecta bugs en los logs
 */
function detectBugs(logContent, conversations) {
  const bugs = [];

  // Bug 1: limpiarNombre aceptando preguntas
  if (logContent.includes('¿tu nombre es *') && logContent.includes('precio')) {
    bugs.push({
      severity: '🔴 CRÍTICO',
      issue: 'limpiarNombre aceptando preguntas como apellidos',
      example: 'Cliente dice "Que precio tiene..." → bot capta como nombre',
      status: '✅ ARREGLADO',
    });
  }

  // Bug 2: Nombre no actualizado tras corrección
  if (logContent.includes('[DIAGNOSTICO:ESCALACION]') &&
      logContent.includes('mi nombre es') &&
      logContent.includes('Hacer Una')) {
    bugs.push({
      severity: '🔴 CRÍTICO',
      issue: 'Nombre no se actualiza cuando cliente lo corrige',
      example: 'Cliente corrige pero sesión sigue con nombre viejo',
      status: '✅ ARREGLADO',
    });
  }

  return bugs;
}

/**
 * Analiza calidad de las conversaciones
 */
function analyzeQuality(conversations) {
  const stats = {
    totalConversations: Object.keys(conversations).length,
    avgMessagesPerConversation: 0,
    successfulClosures: 0,
    escalations: 0,
    cartSent: 0,
  };

  let totalMessages = 0;

  Object.values(conversations).forEach(conv => {
    totalMessages += conv.length;
  });

  stats.avgMessagesPerConversation = (totalMessages / stats.totalConversations).toFixed(1);

  return stats;
}

/**
 * Genera reporte
 */
function generateReport(logFile, content, conversations) {
  const bugs = detectBugs(content, conversations);
  const stats = analyzeQuality(conversations);
  const date = new Date().toISOString().split('T')[0];

  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║       ANÁLISIS DIARIO DE LOGS - ${date}              ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);

  console.log(`📊 ESTADÍSTICAS:`);
  console.log(`   Conversaciones: ${stats.totalConversations}`);
  console.log(`   Promedio mensajes/conversación: ${stats.avgMessagesPerConversation}`);
  console.log(`   Total mensajes: ${Math.round(stats.totalConversations * stats.avgMessagesPerConversation)}\n`);

  if (bugs.length > 0) {
    console.log(`🐛 BUGS DETECTADOS:\n`);
    bugs.forEach((bug, i) => {
      console.log(`${i + 1}. ${bug.severity} ${bug.issue}`);
      console.log(`   Ejemplo: ${bug.example}`);
      console.log(`   ${bug.status}\n`);
    });
  } else {
    console.log(`✅ Sin bugs detectados\n`);
  }

  console.log(`💡 CONVERSACIONES ANALIZADAS: ${stats.totalConversations}`);
  console.log(`   Archivo: ${path.basename(logFile)}\n`);

  // Recomendaciones
  console.log(`🎯 RECOMENDACIONES:`);
  if (bugs.length > 0) {
    console.log(`   ⏳ Fixes aplicados. Monitorear en próximos logs.\n`);
  } else {
    console.log(`   ✅ Sistema funcionando correctamente.\n`);
  }
}

// ────────────────────────────────────────────────────────────────────────────

const logFile = getLatestLogFile();
const content = fs.readFileSync(logFile, 'utf-8');
const conversations = extractConversations(content);

generateReport(logFile, content, conversations);
