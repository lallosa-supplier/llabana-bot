const Anthropic = require('@anthropic-ai/sdk');
const sessionManager  = require('./sessionManager');
const sheetsService   = require('./sheetsService');
const knowledgeService = require('./knowledgeService');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ESTADOS_ENTREGA_DIRECTA = ['ciudad de mexico', 'estado de mexico'];

function normalizarEstado(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // quita acentos
    .trim();
}

const MASTER_PROMPT = `Eres el asistente de Llabana, alimento balanceado para todas las especies (perros, gatos, caballos, cerdos, ganado, borregos, aves, peces). Estás en Ecatepec, Estado de México.

TONO: cálido, directo y sencillo, como platicando con gente de campo. Usa "tú", frases cortas, emojis con medida. Entiende al cliente aunque escriba con errores. Nunca uses "usted". La plática debe sentirse natural, NUNCA como un formulario ni interrogatorio.

REGLA DE ORO: Lee SIEMPRE todo el historial de la conversación antes de responder. Nunca pierdas el contexto ni repitas una pregunta que el cliente ya respondió. Si el cliente te da varios datos juntos, tómalos todos. Si menciona algo y luego sigues con otro paso, recuérdalo y retómalo cuando toque. Piensa como una persona atenta que de verdad está escuchando, no como un formulario que sigue pasos a ciegas.

CÓMO CONVERSAS (en este orden, con naturalidad):
1. Saluda cálido y pide SIEMPRE el nombre primero. PERO si el cliente ya te dijo en su primer mensaje qué necesita (ej. "quiero ser distribuidor en Lerma", "busco alimento para gallos"), NO lo ignores: reconócelo y pide el nombre sin perderlo. Por ejemplo: "¡Con gusto te ayudo con eso! 🙌 Antes de darte la información, ¿con quién tengo el gusto?". El nombre es OBLIGATORIO: no des la información ni avances hasta tenerlo. En cuanto te lo dé, llama de inmediato a registrar_o_actualizar_cliente (incluye en "notas" lo que el cliente pidió desde el inicio). No pidas apellido por separado ni lo conviertas en formulario.
2. Ya con su nombre, RETOMA lo que el cliente pidió originalmente y continúa desde ahí; no vuelvas a preguntar lo que ya te dijo. Si todavía no había dicho qué necesita, ahí sí pregúntale en qué le puedes ayudar. Tienes el historial completo de la conversación: úsalo siempre para no repetir preguntas ni perder el contexto.
3. Escucha qué necesita: para qué animal, qué producto. Si pide asesoría o no sabe qué llevar, ayúdalo y recomienda UNA opción clara del catálogo, adecuada a su animal, etapa o necesidad.
4. Cuando ya entiendas qué busca y sea momento de ver cómo hacerle llegar el pedido (o si pregunta precio o dónde comprar), pídele su código postal de forma natural: "¿De qué código postal nos escribes? Así veo cómo te lo podemos hacer llegar 📦". Ahí llama consultar_zona(cp).
5. Vuelve a llamar registrar_o_actualizar_cliente cuando tengas su CP. Todo debe fluir como plática, nunca como interrogatorio.

SEGÚN LA ZONA QUE DEVUELVA consultar_zona:
- "entrega_directa" → Hay entrega directa. Termina de ver qué producto y cuánto necesita, y llama escalar_a_wig con un resumen completo. Dile que un asesor lo contactará por aquí mismo.
- "paqueteria" → Distingue al cliente:
   - CLIENTE FINAL (mascota o pocos animales, hasta 10 bultos / 250 kg): atiéndelo COMPLETO. Recomienda la opción adecuada, calcula cuántos bultos necesita, dale el precio del catálogo y mándale el link de llabanaenlinea.com para cerrar. Registra con segmento "Cliente final".
   - MAYOREO / NEGOCIO / REVENTA (quiere revender, poner forrajería/negocio, pide descuentos o precios de mayoreo, o más de 10 bultos): dile de forma AMABLE y HONESTA que por ahora solo entregamos pedidos chicos por paquetería y que para el volumen que busca no tenemos cobertura en su zona todavía. NO le mandes el link. Registra con segmento "Mayoreo fuera de zona". Cierra con cortesía, sin prometer nada.

EN CUALQUIER MOMENTO, si hay queja, enojo, problema con un pedido, o el cliente pide hablar con una persona → llama escalar_a_wig.

ASESORÍA: recomienda UNA opción clara, no abras menús salvo que el cliente pida más. Calcula bultos y cotiza con el precio real del catálogo. No ofrezcas productos adicionales por ahora.

NUNCA: reveles cuántas sucursales o en qué estados está Llabana (di solo "Estado de México" y pregunta su ubicación); prometas un día exacto de recolección o entrega; inventes precios (usa siempre el catálogo).

Usa las herramientas para ACTUAR (consultar zona, registrar, escalar). Lo que escribas es lo que el cliente lee.`;

const TOOLS = [
  {
    name: 'consultar_zona',
    description: 'Determina si un CP mexicano está en zona de entrega directa (centro CDMX o cerca de Ecatepec) o si solo aplica paquetería. Llama esto SIEMPRE que tengas el CP, antes de decidir cómo atender.',
    input_schema: { type: 'object', properties: { cp: { type: 'string', description: 'Código postal de 5 dígitos' } }, required: ['cp'] },
  },
  {
    name: 'registrar_o_actualizar_cliente',
    description: 'Guarda o actualiza al cliente en la base. Úsalo en cuanto tengas nombre y apellido, y otra vez cuando tengas CP o definas su segmento.',
    input_schema: { type: 'object', properties: {
      nombre: { type: 'string' }, apellido: { type: 'string' }, cp: { type: 'string' },
      segmento: { type: 'string', description: 'Cliente final | Mayoreo fuera de zona | Lead frío' },
      notas: { type: 'string', description: 'Qué pidió o detalle relevante' },
    }, required: [] },
  },
  {
    name: 'escalar_a_wig',
    description: 'Pasa la conversación a un asesor humano (Wig). SOLO cuando: el cliente está en zona de entrega directa; hay queja/enojo/problema con un pedido; o pide hablar con una persona. Incluye un resumen completo.',
    input_schema: { type: 'object', properties: {
      motivo: { type: 'string', description: 'Razón corta' },
      resumen: { type: 'string', description: 'Resumen de la conversación y datos del cliente' },
    }, required: ['motivo'] },
  },
];

async function toolConsultarZona(cp) {
  const limpio = String(cp || '').replace(/\D/g, '');
  let estado = '', ciudad = '';
  try { const r = await sheetsService.lookupCpMX(limpio); estado = r.state || ''; ciudad = r.city || ''; } catch (e) {}
  const entrega = ESTADOS_ENTREGA_DIRECTA.includes(normalizarEstado(estado));
  return JSON.stringify({ zona: entrega ? 'entrega_directa' : 'paqueteria', estado, ciudad });
}

async function toolRegistrar(input, phone) {
  const nombreCompleto = [input.nombre, input.apellido].filter(Boolean).join(' ').trim();
  const existing = await sheetsService.findCustomer(phone);
  if (existing) {
    const campos = {};
    if (nombreCompleto) campos.name = nombreCompleto;
    if (input.cp) campos.cp = input.cp;
    if (input.segmento) campos.segmento = input.segmento;
    if (input.notas) campos.notas = input.notas;
    await sheetsService.updateOrderData(existing.rowIndex, campos);
    return 'Cliente actualizado.';
  }
  await sheetsService.registerCustomer({
    phone, name: nombreCompleto, email: '', state: '', city: '', cp: input.cp || '',
    channel: 'paqueteria', channelDetail: 'Nacional', segmento: input.segmento || 'Lead frío',
    aceWa: 'SI', entryPoint: 'Directo', origen: 'WhatsApp',
  });
  return 'Cliente registrado.';
}

async function toolEscalar(input, phone, session) {
  const { notifyWig } = require('./botLogic');
  await notifyWig(phone, session, input.motivo || 'Escalación', input.resumen || '');
  await sessionManager.updateSession(phone, { flowState: 'waiting_for_wig' });
  return 'Escalado a Wig. Un asesor lo atenderá.';
}

async function ejecutarHerramienta(nombre, input, phone, session) {
  try {
    if (nombre === 'consultar_zona') return await toolConsultarZona(input.cp);
    if (nombre === 'registrar_o_actualizar_cliente') return await toolRegistrar(input, phone);
    if (nombre === 'escalar_a_wig') return await toolEscalar(input, phone, session);
    return 'Herramienta desconocida';
  } catch (err) {
    console.error(`[AI-BOT] Error en herramienta ${nombre}:`, err.message);
    return `Error ejecutando ${nombre}`;
  }
}

async function buildSystem() {
  let kb = '', productos = '';
  try { kb = await knowledgeService.getKnowledgeBase(); } catch (e) {}
  try { productos = await knowledgeService.getAllProductos(); } catch (e) {}
  return MASTER_PROMPT
    + (kb ? `\n\n━━━ CONOCIMIENTO ━━━\n${kb}` : '')
    + (productos ? `\n\n━━━ CATÁLOGO ━━━\n${productos}` : '');
}

async function handleMessageIA(phone, messageBody) {
  let session = (await sessionManager.getSession(phone)) || (await sessionManager.createSession(phone));
  const history = session.conversationHistory || [];
  history.push({ role: 'user', content: messageBody });

  const system = await buildSystem();
  let messages = history.slice(-20);
  let finalText = '';

  for (let i = 0; i < 5; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1024, system, tools: TOOLS, messages,
    });
    const textos = response.content.filter(b => b.type === 'text').map(b => b.text);
    if (textos.length) finalText = textos.join('\n').trim();

    if (response.stop_reason !== 'tool_use') break;

    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const b of response.content) {
      if (b.type !== 'tool_use') continue;
      console.log(`🤖 [AI-BOT] tool: ${b.name} ${JSON.stringify(b.input)}`);
      const out = await ejecutarHerramienta(b.name, b.input, phone, session);
      results.push({ type: 'tool_result', tool_use_id: b.id, content: out });
    }
    messages.push({ role: 'user', content: results });
  }

  history.push({ role: 'assistant', content: finalText });
  await sessionManager.updateSession(phone, { conversationHistory: history });
  return finalText || 'Disculpa, ¿me repites?';
}

module.exports = { handleMessageIA };
