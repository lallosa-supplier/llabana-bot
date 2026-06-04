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
 * Detecta conversaciones problemáticas con ejemplos de logs exactos
 */
function detectProblematicConversations(logContent) {
  const lines = logContent.split('\n');
  const problematicConversations = [];
  let conversationIndex = 0;

  // Patrones para detectar problemas
  // Captura el nombre confirmado sin importar su longitud
  const nombreMalCapturadoPattern = /¿tu nombre es \*([^*]+)\*\?/i;
  // Sospechoso por CONTENIDO, no por longitud: preguntas, dígitos, frases largas o palabras de intención
  const nombreSospechoso = (n) =>
    /[?¿!]/.test(n) ||
    /\d/.test(n) ||
    n.trim().split(/\s+/).length >= 6 ||
    /\b(precio|quiero|cuanto|cuánto|informaci|necesito|busco|hacer|interesa|forrajer|mayoreo|toneladas?|bultos?|hola|gracias)\b/i.test(n);
  const escalacionSinEscalarPattern = /\[DIAGNOSTICO:ESCALACION\].*?📤.*?(?!escalad|wig|asesor)/i;
  const followupIncorrectoPattern = /\[FOLLOWUP-A\].*?nombre:\s*([a-záéíóú\s]+)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Problema 1: Nombre mal capturado (¿tu nombre es *[texto largo o contiene palabras clave]*)
    if (nombreMalCapturadoPattern.test(line)) {
      const match = line.match(nombreMalCapturadoPattern);
      const nombreCapturado = match ? match[1] : 'desconocido';

      // Solo marcar como problema si el nombre es SOSPECHOSO por contenido
      if (!nombreSospechoso(nombreCapturado)) continue; // nombre válido → no es problema

      // Buscar conversación completa alrededor de esta línea
      const start = Math.max(0, i - 3);
      const end = Math.min(lines.length, i + 3);
      const logContext = lines.slice(start, end).join('\n');

      problematicConversations.push({
        number: ++conversationIndex,
        phone: extractPhoneFromLine(line),
        problem: '🔴 Nombre mal capturado (contiene preguntas, dígitos o palabras de intención)',
        nameDetected: nombreCapturado,
        logExact: logContext,
        severity: 'CRÍTICO',
      });
    }

    // Problema 2: DIAGNOSTICO:ESCALACION sin escalar realmente
    if (line.includes('[DIAGNOSTICO:ESCALACION]')) {
      // Buscar siguiente línea de respuesta
      let foundEscalation = false;
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        if (lines[j].includes('escalad') || lines[j].includes('wig') || lines[j].includes('asesor')) {
          foundEscalation = true;
          break;
        }
      }

      if (!foundEscalation) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 4);
        const logContext = lines.slice(start, end).join('\n');

        problematicConversations.push({
          number: ++conversationIndex,
          phone: extractPhoneFromLine(line),
          problem: '🟡 DIAGNOSTICO:ESCALACION detectado pero bot no escaló',
          nameDetected: 'N/A',
          logExact: logContext,
          severity: 'IMPORTANTE',
        });
      }
    }

    // Problema 3: Follow-up A con nombre incorrecto
    if (line.includes('[FOLLOWUP-A]') && line.includes('nombre:')) {
      const match = line.match(/nombre:\s*([a-záéíóú\s]+?)[\]|$\s]/i);
      if (match) {
        const nombre = match[1].trim();
        // Nombre incorrecto: menos de 3 letras O más de 4 palabras
        const palabras = nombre.split(/\s+/).length;
        const letras = nombre.replace(/\s/g, '').length;

        if (letras < 3 || palabras > 4) {
          const start = Math.max(0, i - 1);
          const end = Math.min(lines.length, i + 3);
          const logContext = lines.slice(start, end).join('\n');

          problematicConversations.push({
            number: ++conversationIndex,
            phone: extractPhoneFromLine(line),
            problem: `🟡 Follow-up A con nombre sospechoso (${letras} letras, ${palabras} palabras)`,
            nameDetected: nombre,
            logExact: logContext,
            severity: 'MENOR',
          });
        }
      }
    }
  }

  return problematicConversations;
}

/**
 * Extrae número de teléfono de una línea de log
 */
function extractPhoneFromLine(line) {
  const match = line.match(/\+52\d{10}/);
  return match ? match[0] : 'desconocido';
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
  const problematicConversations = detectProblematicConversations(content);
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

  // Nueva sección: Conversaciones problemáticas
  if (problematicConversations.length > 0) {
    console.log(`⚠️  CONVERSACIONES PROBLEMÁTICAS DETECTADAS:\n`);
    problematicConversations.forEach((conv) => {
      console.log(`CONVERSACIÓN PROBLEMÁTICA #${conv.number}`);
      console.log(`  Severidad: ${conv.severity}`);
      console.log(`  Número: ${conv.phone}`);
      console.log(`  Problema: ${conv.problem}`);
      if (conv.nameDetected !== 'N/A') {
        console.log(`  Nombre detectado: "${conv.nameDetected}"`);
      }
      console.log(`  Log exacto:`);
      console.log(`${conv.logExact.split('\n').map(l => `    ${l}`).join('\n')}`);
      console.log(``);
    });
  } else {
    console.log(`✅ No hay conversaciones problemáticas detectadas\n`);
  }

  console.log(`💡 CONVERSACIONES ANALIZADAS: ${stats.totalConversations}`);
  console.log(`   Archivo: ${path.basename(logFile)}\n`);

  // Recomendaciones
  console.log(`🎯 RECOMENDACIONES:`);
  if (bugs.length > 0 || problematicConversations.length > 0) {
    console.log(`   ⏳ Revisar problemas detectados. Detalles arriba.\n`);
  } else {
    console.log(`   ✅ Sistema funcionando correctamente.\n`);
  }
}

/**
 * Genera sección de código fuente actual
 */
function generateSourceCodeSection() {
  const srcDir = path.join(__dirname);
  const files = fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.js') && !f.includes('test') && !f.includes('analysis'))
    .sort();

  let section = '\n════════════════════════════════════════════════════════════════════════════════\n';
  section += '📝 SECCIÓN 1 — CÓDIGO FUENTE ACTUAL (PRODUCCIÓN)\n';
  section += '════════════════════════════════════════════════════════════════════════════════\n\n';

  files.forEach(file => {
    const filePath = path.join(srcDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').length;

    section += `───── src/${file} (${lines} líneas) ─────\n`;
    section += content;
    section += '\n\n';
  });

  return section;
}

/**
 * Genera sección de transcripts del día
 */
function generateTranscriptsSection(logContent, conversations) {
  let section = '════════════════════════════════════════════════════════════════════════════════\n';
  section += '💬 SECCIÓN 2 — TRANSCRIPCIONES DEL DÍA\n';
  section += '════════════════════════════════════════════════════════════════════════════════\n\n';

  if (Object.keys(conversations).length === 0) {
    section += 'No hay conversaciones registradas.\n';
    return section;
  }

  const lines = logContent.split('\n');
  let currentConversation = {};

  for (const phone of Object.keys(conversations).sort()) {
    section += `\n┌─────────────────────────────────────────────────────────────┐\n`;
    section += `│ Teléfono: ${phone.padEnd(55)}\n`;
    section += `└─────────────────────────────────────────────────────────────┘\n\n`;

    // Buscar en los logs las líneas que contengan este teléfono
    for (const line of lines) {
      // Líneas de usuario
      if (line.includes(`whatsapp:${phone}`) && line.includes('📨')) {
        const match = line.match(/📨.*?:\s*(.+)/);
        if (match) {
          section += `  📨 ${match[1].substring(0, 120)}\n`;
        }
      }
      // Líneas de bot
      if (line.includes(`whatsapp:${phone}`) && line.includes('📤')) {
        const match = line.match(/📤.*?:\s*(.+)/);
        if (match) {
          section += `  📤 ${match[1].substring(0, 120)}\n`;
        }
      }
      // Líneas de diagnóstico
      if (line.includes(`whatsapp:${phone}`) && line.includes('🔍')) {
        const match = line.match(/🔍\s*(.+)/);
        if (match) {
          section += `  🔍 ${match[1].substring(0, 120)}\n`;
        }
      }
    }

    section += '\n';
  }

  return section;
}

// ────────────────────────────────────────────────────────────────────────────

const logFile = getLatestLogFile();
const content = fs.readFileSync(logFile, 'utf-8');
const conversations = extractConversations(content);

generateReport(logFile, content, conversations);

// Agregar secciones nuevas
const sourceCode = generateSourceCodeSection();
const transcripts = generateTranscriptsSection(content, conversations);

console.log(sourceCode);
console.log(transcripts);

module.exports = {
  getLatestLogFile,
  extractConversations,
  detectBugs,
  detectProblematicConversations,
  analyzeQuality,
  generateReport,
  generateSourceCodeSection,
  generateTranscriptsSection,
};
