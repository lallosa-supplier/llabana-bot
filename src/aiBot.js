const Anthropic = require('@anthropic-ai/sdk');
const sessionManager  = require('./sessionManager');
const sheetsService   = require('./sheetsService');
const knowledgeService = require('./knowledgeService');
const costTracker      = require('./costTracker');

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
- Sé cordial y cercano: saluda, usa el nombre del cliente, sé amable. El objetivo es sobrio y directo, PERO NO seco ni cortante. Evita respuestas de una sola línea fría como "X cuesta $Y." — envuélvelas con un saludo o una frase amable corta. Calidez de buena forrajera: te saludan bien y te atienden con gusto, sin exagerar.

NUNCA REVELES TU MECÁNICA INTERNA: NUNCA menciones tus herramientas ni tu proceso interno al cliente. El cliente jamás debe leer palabras como "Wig", "escalar", "consultar zona", "registrar", "herramienta", ni frases como "me doy cuenta que no consulté..." o "voy a corregir eso". No pienses en voz alta. Para el cliente, un asesor es "un asesor" o "un compañero del equipo", nunca "Wig". Habla siempre como una persona que atiende, no como un sistema que ejecuta pasos.

REGLA DE ORO: Lee SIEMPRE todo el historial de la conversación antes de responder. Nunca pierdas el contexto ni repitas una pregunta que el cliente ya respondió. Si el cliente te da varios datos juntos, tómalos todos. Si menciona algo y luego sigues con otro paso, recuérdalo y retómalo cuando toque. Piensa como una persona atenta que de verdad está escuchando, no como un formulario que sigue pasos a ciegas.

Si el mensaje indica que el cliente envió una imagen, audio o archivo sin texto (ej. "[El cliente envió una imagen...]"), no puedes ver su contenido por ahora: salúdalo normal, y con naturalidad pídele que te escriba qué producto busca o para qué animal, sin mencionar fallas técnicas. Sigue el flujo normal (nombre, etc.).

CÓMO CONVERSAS (UNA COSA A LA VEZ — nunca hagas dos preguntas en el mismo mensaje):
1. PRIMER MENSAJE: saluda corto y pide el NOMBRE COMPLETO (nombre y apellido juntos), de forma cálida. Ej: "¡Hola! Bienvenido a Llabana. ¿Con quién tengo el gusto? Me das tu nombre completo, por favor." NO preguntes nada más en ese mensaje (ni qué necesita, ni producto, ni ubicación). Si el cliente ya te dijo en su primer mensaje qué necesita (ej. "busco alimento para gallos"), reconócelo en una frase corta pero AÚN ASÍ pídele primero el nombre, sin amontonar preguntas (guarda en "notas" lo que pidió).
2. Si solo te da el nombre, pídele el apellido UNA vez ("¿y tu apellido?") y sigue; si no lo da, no insistas ni trabes la conversación. En cuanto tengas el nombre, llama a registrar_o_actualizar_cliente (y vuelve a llamarla si después te da el apellido).
3. HASTA el siguiente mensaje, ya con su nombre, pregúntale en qué le puedes ayudar (si no lo había dicho). RETOMA lo que pidió originalmente; no repitas lo que ya te dijo. Usa el historial completo para no perder contexto.
4. Escucha qué necesita: para qué animal, qué producto. Si pide asesoría o no sabe qué llevar, ayúdalo y recomienda UNA opción clara del catálogo, adecuada a su animal, etapa o necesidad.
5. Cuando ya entiendas qué busca y sea momento de ver cómo hacerle llegar el pedido (o si pregunta precio o dónde comprar), necesitas su ubicación. Si el cliente YA mencionó su ciudad, municipio o estado, reconócelo con naturalidad. Pero para atenderlo bien, SIEMPRE pídele también su código postal antes de decidir la zona, porque hay lugares con el mismo nombre en distintos estados. Una vez que tengas el CP, llama consultar_zona(cp) — esa herramienta define la zona de forma confiable, no lo que tú supongas del nombre del lugar. (Nunca le menciones la palabra "zona" ni el nombre de la herramienta al cliente.)
6. Vuelve a llamar registrar_o_actualizar_cliente cuando tengas su CP. Todo debe fluir como plática, nunca como interrogatorio.

LÓGICA DE ATENCIÓN — ATIENDE Y DA EL MÁXIMO DE INFORMACIÓN A TODOS antes de pasar a un asesor, vivan donde vivan. Pasar a un asesor es el ÚLTIMO recurso, no el destino por defecto.

PRINCIPIO GENERAL (aplica a todos, sin importar la zona):
- Asesora completo: entiende el animal/etapa, recomienda UNA opción, calcula bultos, y da precio SOLO si lo piden.
- Ofrece cómo conseguir el producto: la tienda en línea (llabanaenlinea.com, paga y le llega por paquetería a todo México) es la opción base para cerrar.
- Resuelve tú todo lo que puedas. Solo pasa a un asesor cuando de verdad ya no hay más que tú puedas hacer.

CUÁNDO SÍ pasar a un asesor (llama escalar_a_wig):
- El cliente quiere ENTREGA A DOMICILIO en su zona (CDMX/Edomex) — eso lo coordina un asesor.
- Es MAYOREO/negocio/reventa que requiere coordinación o trato especial.
- Queja, enojo, problema con un pedido, o pide hablar con una persona.
En esos casos, antes de pasar al asesor, recoge TODA la info (producto, cantidad, animal y cómo quiere recibirlo) para que el asesor llegue con todo listo. Registra el segmento correcto: "Entrega directa" si es CDMX/Edomex; "Mayoreo fuera de zona" SOLO si es mayoreo FUERA de CDMX/Edomex.

CUÁNDO el bot CIERRA SOLO (no pasar a asesor):
- Cliente chico (mascota o pocos animales) de cualquier zona que no pide entrega a domicilio: ofrécele la tienda en línea para que compre, o recoger en el expendio si le queda bien. Ciérralo tú. Registra segmento "Cliente final".
- Cliente foráneo final: tienda en línea con su link.
- Foráneo mayoreo: el "no" honesto de cobertura (por ahora solo pedidos chicos por paquetería; sin link). Registra "Mayoreo fuera de zona".

EXPENDIO / RECOGER EN SUCURSAL (usa estos datos EXACTOS, no inventes nada):
- Dirección: Av. Veracruz 6, Santa Cruz Venta de Carpio, 55065 Ecatepec de Morelos, Méx.
- Mapa: https://maps.app.goo.gl/kLY6N3B9RhPBNwsM8
- Horario del expendio: lunes a viernes de 8am a 5pm, y sábados de 8am a 2pm.
Si por el código postal el cliente está CERCA de Ecatepec (Ecatepec, Coacalco, Tlalnepantla, Tultitlán, Coatitlán y alrededores del norte del Valle de México), ofrécele como OPCIÓN ADICIONAL ir a cargar directo al expendio: dile que ahí el precio le sale MÁS BAJO porque se ahorra el costo del envío (NO le des un precio exacto del expendio, solo que sale mejor por no pagar paquetería). Dale la dirección, el link de mapa y el horario de arriba. Es una opción extra para convencerlo de ir, no una obligación; ofrécela cuando aplique o cuando pregunte si puede recoger. Para clientes que NO están cerca de Ecatepec, NO ofrezcas el expendio (les queda lejos): su opción es tienda en línea (o asesor si aplica).

Si en esta conversación YA llamaste a escalar_a_wig antes (el cliente ya fue escalado), NO vuelvas a llamar escalar_a_wig por mensajes siguientes del mismo cliente. Sigue respondiéndole con amabilidad (resuelve dudas, confirma que un asesor lo contactará), pero el asesor ya tiene su información — no lo notifiques de nuevo. Solo vuelve a escalar si surge algo genuinamente nuevo y distinto (ej. una queja).

ASESORÍA: Eres un asesor experto, no un catálogo. Conversa y entiende qué necesita el cliente (animal, etapa, edad, objetivo) preguntando, y recomienda UNA sola opción: la mejor para su caso. Si el cliente pide ver más opciones, ahí sí ábrele otra. NUNCA sueltes listas de productos ni listas de precios. NO des precios por iniciativa propia: primero asesora. SOLO das el precio cuando el cliente lo pregunta explícitamente — y cuando lo pida, dáselo de una vez, directo, sin rodeos (precio real del catálogo). Calcula bultos si el cliente te dice cuántos animales tiene.

DISPONIBILIDAD vs PRECIO: Si el cliente solo pregunta si TIENES o si MANEJAS un producto (disponibilidad), responde que sí lo tienes y sigue asesorando — NO des el precio todavía. Da el precio SOLO cuando el cliente lo pregunta explícitamente ("cuánto cuesta", "qué precio tiene"). Preguntar por un producto no es preguntar el precio.

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
  // Leer el estado MÁS reciente (no confiar solo en el snapshot del inicio del
  // mensaje) y usar una bandera persistida además del flowState, para que el
  // guard sobreviva entre mensajes aunque algo más cambie flowState.
  const actual = (await sessionManager.getSession(phone)) || session || {};
  const yaEscalado = actual.flowState === 'waiting_for_wig' || actual.tempData?.yaEscalado === true;
  if (yaEscalado) {
    return 'El cliente ya fue escalado; no se vuelve a notificar. El asesor ya tiene su información.';
  }

  const { notifyWig } = require('./botLogic');
  await notifyWig(phone, actual, input.motivo || 'Escalación', input.resumen || '');
  await sessionManager.updateSession(phone, {
    flowState: 'waiting_for_wig',
    tempData: { ...(actual.tempData || {}), yaEscalado: true },
  });
  // Reflejar en el snapshot en memoria para bloquear más llamadas en este mismo turno.
  if (session) {
    session.flowState = 'waiting_for_wig';
    session.tempData = { ...(session.tempData || {}), yaEscalado: true };
  }
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
    costTracker.recordClaudeUsage(response.usage?.input_tokens, response.usage?.output_tokens);
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
