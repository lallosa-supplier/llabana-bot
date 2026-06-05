#!/usr/bin/env node
/**
 * Genera un log limpio con conversaciones reales
 * Para copiar/pegar a Claude.ai y analizar
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Lee el log más reciente
function getLatestLogFile() {
  const files = fs.readdirSync(LOGS_DIR)
    .filter(f => f.startsWith('logs.') && f.endsWith('.log'))
    .sort()
    .reverse();
  return path.join(LOGS_DIR, files[0]);
}

const logFile = getLatestLogFile();
const content = fs.readFileSync(logFile, 'utf-8');
const lines = content.split('\n');

// Extrae timestamp
function getTimestamp(line) {
  const match = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : null;
}

// Extrae conversaciones
const conversations = {};

for (const line of lines) {
  // Mensaje de usuario
  const userMatch = line.match(/📨\s+\[whatsapp:(\+52\d+)\]:\s*(.+)/);
  if (userMatch) {
    const phone = userMatch[1];
    const message = userMatch[2];
    const timestamp = getTimestamp(line);
    if (!conversations[phone]) {
      conversations[phone] = { messages: [] };
    }
    conversations[phone].messages.push({
      time: timestamp,
      type: 'usuario',
      text: message,
    });
    continue;
  }

  // Mensaje de bot
  const botMatch = line.match(/📤\s+\[whatsapp:(\+52\d+)\]:\s*(.+)/);
  if (botMatch) {
    const phone = botMatch[1];
    const message = botMatch[2];
    const timestamp = getTimestamp(line);
    if (!conversations[phone]) {
      conversations[phone] = { messages: [] };
    }
    conversations[phone].messages.push({
      time: timestamp,
      type: 'bot',
      text: message,
    });
  }
}

// Ordena por última actividad
const sorted = Object.entries(conversations)
  .sort((a, b) => {
    const timeA = a[1].messages[a[1].messages.length - 1]?.time || '';
    const timeB = b[1].messages[b[1].messages.length - 1]?.time || '';
    return timeB.localeCompare(timeA);
  });

// Genera el log
let output = `═══════════════════════════════════════════════════════════════════════════════
                         LOG DE CONVERSACIONES
═══════════════════════════════════════════════════════════════════════════════

📊 INFORMACIÓN GENERAL
─────────────────────────────────────────────────────────────────────────────
Archivo: ${path.basename(logFile)}
Generado: ${new Date().toISOString()}
Total de conversaciones: ${sorted.length}

PERÍODO A ANALIZAR:
├─ Desde: ${getTimestamp(lines.find(l => getTimestamp(l))) || 'N/A'}
└─ Hasta: ${getTimestamp(lines.reverse().find(l => getTimestamp(l))) || 'N/A'}

═══════════════════════════════════════════════════════════════════════════════

`;

// Por cada conversación
for (const [phone, data] of sorted) {
  if (data.messages.length === 0) continue;

  const firstTime = data.messages[0].time;
  const lastTime = data.messages[data.messages.length - 1].time;

  output += `┌─ CONVERSACIÓN #${sorted.indexOf([phone, data]) + 1} ────────────────────────────────────────┐
│
│ Teléfono: ${phone}
│ Inicio:   ${firstTime}
│ Fin:      ${lastTime}
│ Mensajes: ${data.messages.length}
│
`;

  for (const msg of data.messages) {
    const marker = msg.type === 'usuario' ? '👤' : '🤖';
    const lines = msg.text.split('\n');
    output += `│ ${marker} [${msg.time}] ${msg.type.toUpperCase()}\n`;
    for (const line of lines) {
      output += `│    ${line}\n`;
    }
  }

  output += `│
└────────────────────────────────────────────────────────────────────────────┘

`;
}

// Salida
output += `═══════════════════════════════════════════════════════════════════════════════
FIN DEL LOG
═══════════════════════════════════════════════════════════════════════════════

✅ COPIAR TODO ESTO A CLAUDE.AI PARA ANALIZAR
`;

console.log(output);

// Guardar archivo
const date = new Date().toISOString().split('T')[0];
const outputFile = path.join(__dirname, '..', 'daily-analysis', `LOG-${date}.txt`);
fs.writeFileSync(outputFile, output);
console.log(`\n✓ Guardado en: ${outputFile}`);
