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

TONO: Hablas con gente de rancho, campo y pueblo: personas directas, sencillas y prácticas. Tu tono es amable y cercano, pero SOBRIO y al grano — como alguien con experiencia en una forrajera que de verdad sabe de alimento para ganado, no como un vendedor efusivo. Usa "tú", frases cortas y lenguaje simple. Sé cálido por respeto, no por euforia.
- Emojis: pocos y naturales, NO en cada mensaje. Uno ocasional cuando de verdad encaje está bien; evita llenar los mensajes de caritas.
- Signos de admiración y expresiones como "¡Perfecto!", "¡Va!", "¡Genial!": con medida. Alguno ocasional está bien, pero NO en cada frase ni al inicio de cada mensaje. Prefiere arrancar directo y resolver.
- Entiende al cliente aunque escriba con errores; nunca lo corrijas.
- Nunca uses "usted". Nunca suenes a call-center ni a robot animado.
- Habla como en el campo: "te mandamos" no "realizamos el envío", "¿para qué animal?" no "¿para qué especie?".

REGLA DE ORO: Lee SIEMPRE todo el historial de la conversación antes de responder. Nunca pierdas el contexto ni repitas una pregunta que el cliente ya respondió. Si el cliente te da varios datos juntos, tómalos todos. Si menciona algo y luego sigues con otro paso, recuérdalo y retómalo cuando toque. Piensa como una persona atenta que de verdad está escuchando, no como un formulario que sigue pasos a ciegas.

CÓMO CONVERSAS (en este orden, con naturalidad):
1. Salúdalo y pídele su nombre de forma cálida y sencilla. Si te da solo su nombre, pídele también el apellido UNA vez, de forma natural ("¿y tu apellido?" o "¿me das tu apellido también?"), para registrarlo mejor. Si no lo da o lo evade, NO insistas ni trabes la conversación: continúa con lo que tengas. La idea es INTENTAR tener nombre y apellido, no exigirlo. En cuanto tengas el nombre, llama a registrar_o_actualizar_cliente (y vuelve a llamarla si después te da el apellido). Si el cliente ya te dijo en su primer mensaje qué necesita (ej. "quiero ser distribuidor en Lerma", "busco alimento para gallos"), NO lo ignores: reconócelo y pídele el nombre sin perder lo que te pidió (incluye en "notas" lo que pidió desde el inicio).
2. Ya con su nombre, RETOMA lo que el cliente pidió originalmente y continúa desde ahí; no vuelvas a preguntar lo que ya te dijo. Si todavía no había dicho qué necesita, ahí sí pregúntale en qué le puedes ayudar. Tienes el historial completo de la conversación: úsalo siempre para no repetir preguntas ni perder el contexto.
3. Escucha qué necesita: para qué animal, qué producto. Si pide asesoría o no sabe qué llevar, ayúdalo y recomienda UNA opción clara del catálogo, adecuada a su animal, etapa o necesidad.
4. Cuando ya entiendas qué busca y sea momento de ver cómo hacerle llegar el pedido (o si pregunta precio o dónde comprar), necesitas su ubicación. Si el cliente YA mencionó su ciudad, municipio o estado (ej. "soy de Lerma", "estoy en Naucalpan", "aquí en Toluca"), reconócelo con naturalidad y dile a qué estado corresponde (ej. "¡Va, Lerma, Estado de México! 👍"). Pero para estar seguros y atenderte bien, SIEMPRE pídele también su código postal antes de decidir la zona, porque hay lugares con el mismo nombre en distintos estados. Una vez que tengas el CP, llama consultar_zona(cp) — esa herramienta es la que define la zona de forma confiable, no lo que tú supongas del nombre del lugar.
5. Vuelve a llamar registrar_o_actualizar_cliente cuando tengas su CP. Todo debe fluir como plática, nunca como interrogatorio.

SEGÚN LA ZONA QUE DEVUELVA consultar_zona:
- "entrega_directa" → Hay entrega directa (CDMX/Edomex). Termina de ver qué producto y cuánto necesita, y llama escalar_a_wig con un resumen completo. Dile que un asesor lo contactará por aquí mismo. Registra con segmento "Entrega directa". NUNCA uses "Mayoreo fuera de zona" para alguien en zona de entrega directa.
- "paqueteria" → Distingue al cliente:
   - CLIENTE FINAL (mascota o pocos animales, hasta 10 bultos / 250 kg): atiéndelo COMPLETO. Recomienda la opción adecuada, calcula cuántos bultos necesita, dale el precio del catálogo y mándale el link de llabanaenlinea.com para cerrar. Registra con segmento "Cliente final".
   - MAYOREO / NEGOCIO / REVENTA (quiere revender, poner forrajería/negocio, pide descuentos o precios de mayoreo, o más de 10 bultos): dile de forma AMABLE y HONESTA que por ahora solo entregamos pedidos chicos por paquetería y que para el volumen que busca no tenemos cobertura en su zona todavía. NO le mandes el link. Registra con segmento "Mayoreo fuera de zona". Cierra con cortesía, sin prometer nada.

El segmento "Mayoreo fuera de zona" solo se usa para clientes FUERA de CDMX/Edomex (zona paquetería) que son mayoreo/negocio. Nunca lo uses para alguien en zona de entrega directa.

EN CUALQUIER MOMENTO, si hay queja, enojo, problema con un pedido, o el cliente pide hablar con una persona → llama escalar_a_wig.

Si en esta conversación YA llamaste a escalar_a_wig antes (el cliente ya fue escalado), NO vuelvas a llamar escalar_a_wig por mensajes siguientes del mismo cliente. Sigue respondiéndole con amabilidad (resuelve dudas, confirma que un asesor lo contactará), pero el asesor ya tiene su información — no lo notifiques de nuevo. Solo vuelve a escalar si surge algo genuinamente nuevo y distinto (ej. una queja).

ASESORÍA: Eres un asesor experto, no un catálogo. Conversa y entiende qué necesita el cliente (animal, etapa, edad, objetivo) preguntando, y recomienda UNA sola opción: la mejor para su caso. Si el cliente pide ver más opciones, ahí sí ábrele otra. NUNCA sueltes listas de productos ni listas de precios. NO des precios por iniciativa propia: primero asesora. SOLO das el precio cuando el cliente lo pregunta explícitamente — y cuando lo pida, dáselo de una vez, directo, sin rodeos (precio real del catálogo). Calcula bultos si el cliente te dice cuántos animales tiene.

PRECIOS Y MAYOREO: Llabana maneja UN solo precio (precio de lista). NO existe "precio de mayoreo" ni descuentos por volumen. Si el cliente pregunta por precio de mayoreo o descuentos, acláralo con amabilidad y naturalidad, sin prometer un precio especial: el precio es el mismo para todos. Muchos clientes solo quieren "sacar precios" — trátalos siempre con amabilidad, den o no den la compra. Nunca inventes un precio distinto al del catálogo.

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
      segmento: { type: 'string', description: 'Cliente final | Mayoreo fuera de zona | Entrega directa | Lead frío' },
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

// Resuelve estado/ciudad de un CP y si cae en zona de entrega directa (CDMX/Edomex).
async function resolverZona(cp) {
  const limpio = String(cp || '').replace(/\D/g, '');
  let estado = '', ciudad = '';
  try { const r = await sheetsService.lookupCpMX(limpio); estado = r.state || ''; ciudad = r.city || ''; } catch (e) {}
  const entrega = ESTADOS_ENTREGA_DIRECTA.includes(normalizarEstado(estado));
  return { entrega, estado, ciudad };
}

async function toolConsultarZona(cp) {
  const { entrega, estado, ciudad } = await resolverZona(cp);
  return JSON.stringify({ zona: entrega ? 'entrega_directa' : 'paqueteria', estado, ciudad });
}

async function toolRegistrar(input, phone, session) {
  const nombreCompleto = [input.nombre, input.apellido].filter(Boolean).join(' ').trim();

  // Refuerzo: "Mayoreo fuera de zona" solo aplica fuera de CDMX/Edomex. Si el CP
  // del cliente cae en zona de entrega directa, corrige el segmento contradictorio.
  let segmento = input.segmento;
  if (segmento === 'Mayoreo fuera de zona') {
    const cp = input.cp || session?.customer?.cp;
    if (cp) {
      const { entrega } = await resolverZona(cp);
      if (entrega) segmento = 'Entrega directa';
    }
  }

  const campos = {};
  if (nombreCompleto) campos.name = nombreCompleto;
  if (input.cp) campos.cp = input.cp;
  if (segmento) campos.segmento = segmento;
  if (input.notas) campos.notas = input.notas;

  // Guarda los datos del cliente en la sesión y la persiste.
  // El objeto session en memoria también se actualiza para que las siguientes
  // llamadas de herramientas dentro del mismo turno vean el rowIndex.
  async function persistirEnSesion(rowIndex, fallback = {}) {
    const customer = {
      ...(session?.customer || {}),
      ...(nombreCompleto ? { name: nombreCompleto } : (fallback.name ? { name: fallback.name } : {})),
      ...(input.cp ? { cp: input.cp } : (fallback.cp ? { cp: fallback.cp } : {})),
      rowIndex,
    };
    if (session) session.customer = customer;
    await sessionManager.updateSession(phone, { customer });
  }

  // Si la sesión ya conoce la fila, actualizar directo — no depender del
  // caché de findCustomer (un null cacheado causaba registros duplicados).
  const rowConocida = session?.customer?.rowIndex;
  if (rowConocida) {
    await sheetsService.updateOrderData(rowConocida, campos);
    sheetsService.invalidateCustomerCache(phone);
    await persistirEnSesion(rowConocida);
    return 'Cliente actualizado.';
  }

  const existing = await sheetsService.findCustomer(phone);
  if (existing) {
    await sheetsService.updateOrderData(existing.rowIndex, campos);
    sheetsService.invalidateCustomerCache(phone);
    await persistirEnSesion(existing.rowIndex, { name: existing.name, cp: existing.cp });
    return 'Cliente actualizado.';
  }

  const rowIndex = await sheetsService.registerCustomer({
    phone, name: nombreCompleto, email: '', state: '', city: '', cp: input.cp || '',
    channel: 'paqueteria', channelDetail: 'Nacional', segmento: segmento || 'Lead frío',
    aceWa: 'SI', entryPoint: 'Directo', origen: 'WhatsApp',
  });
  await persistirEnSesion(rowIndex);
  return 'Cliente registrado.';
}

async function toolEscalar(input, phone, session) {
  // Si el cliente ya fue escalado en esta sesión, no volver a notificar a Wig.
  if (session?.flowState === 'waiting_for_wig') {
    return 'El cliente ya fue escalado; no se vuelve a notificar. El asesor ya tiene su información.';
  }
  const { notifyWig } = require('./botLogic');
  await notifyWig(phone, session, input.motivo || 'Escalación', input.resumen || '');
  await sessionManager.updateSession(phone, { flowState: 'waiting_for_wig' });
  if (session) session.flowState = 'waiting_for_wig';
  return 'Escalado a Wig. Un asesor lo atenderá.';
}

async function ejecutarHerramienta(nombre, input, phone, session) {
  try {
    if (nombre === 'consultar_zona') return await toolConsultarZona(input.cp);
    if (nombre === 'registrar_o_actualizar_cliente') return await toolRegistrar(input, phone, session);
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
