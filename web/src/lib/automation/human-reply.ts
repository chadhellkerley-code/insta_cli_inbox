export type HumanReplyConversationMessage = {
  direction: "in" | "out";
  message_type: string;
  text_content: string | null;
  created_at: string | null;
};

export type HumanReplyOptions = {
  personality: string | null;
  aiPrompt: string | null;
  generationPrompt?: string | null;
  inboundText: string;
  conversationMessages?: HumanReplyConversationMessage[];
};

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function formatConversationTranscript(messages: HumanReplyConversationMessage[]) {
  return messages
    .map((message) => {
      const sender = message.direction === "out" ? "Agente" : "Cliente";
      const text = normalizeOptionalString(message.text_content);

      if (text) {
        return `${sender}: ${text}`;
      }

      if (message.message_type === "audio") {
        return `${sender}: [audio sin transcripcion]`;
      }

      return `${sender}: [mensaje ${message.message_type || "sin texto"}]`;
    })
    .filter(Boolean)
    .join("\n");
}

export function buildHumanReplySystemPrompt(options: HumanReplyOptions) {
  const hasSmartTextPrompt = Boolean(normalizeOptionalString(options.generationPrompt));

  return [
    "Sos un agente humano respondiendo DMs de Instagram.",
    "Tu tarea es responder de forma natural, breve y util al ultimo mensaje del cliente, como una persona escribiendo desde la cuenta.",
    "Jerarquia de instrucciones: primero responde el inbound actual sin ignorar preguntas concretas; despues cumple al pie de la letra la instruccion especifica del texto inteligente; despues aplica el prompt general y la personalidad.",
    "Usa el historial solo como contexto para no repetir, no contradecirte y entender la conversacion.",
    hasSmartTextPrompt
      ? "La instruccion especifica del texto inteligente no es una idea: es una orden. Respeta sus requisitos verificables de contenido, tono, longitud, idioma, datos a pedir, datos a evitar y CTA."
      : null,
    "Si una instruccion especifica choca con responder bien al cliente, responde al cliente y conserva la intencion de la instruccion en la forma mas cercana posible.",
    "No inventes precios, disponibilidad, links, promesas, descuentos, diagnosticos ni datos que no esten en el contexto.",
    "Si falta informacion, pedi solo el dato minimo necesario.",
    "Escribi como DM: claro, humano, cotidiano, sin sonar corporativo ni asistente virtual, sin markdown, sin encabezados, sin 'Respuesta:'.",
    "Evita frases genericas de bot como 'con gusto', 'quedo atento', 'espero que estes bien', 'estoy aqui para ayudarte' o cierres repetidos.",
    "No expliques que sos IA, bot, automatizacion ni asistente.",
    "Antes de devolver el texto, verifica internamente que responde el inbound, cumple la instruccion especifica y suena natural. No incluyas esa verificacion.",
    "Devuelve solo el texto final que se va a enviar al cliente.",
    normalizeOptionalString(options.personality)
      ? `Personalidad del agente: ${normalizeOptionalString(options.personality)}`
      : null,
    normalizeOptionalString(options.aiPrompt)
      ? `Instrucciones generales del agente: ${normalizeOptionalString(options.aiPrompt)}`
      : null,
    normalizeOptionalString(options.generationPrompt)
      ? `Instruccion especifica del texto inteligente: ${normalizeOptionalString(options.generationPrompt)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildHumanReplyMessages(options: HumanReplyOptions) {
  const transcript = formatConversationTranscript(options.conversationMessages ?? []);
  const inboundText =
    normalizeOptionalString(options.inboundText) ?? "El cliente envio un mensaje sin texto.";

  return [
    {
      role: "user" as const,
      content: [
        transcript ? `Historial reciente:\n${transcript}` : "Historial reciente: sin mensajes previos.",
        "",
        `Inbound actual que debes responder ahora:\nCliente: ${inboundText}`,
        "",
        "Genera una respuesta conectada directamente con ese inbound y lista para enviar por Instagram DM.",
      ].join("\n"),
    },
  ];
}

export function sanitizeGeneratedHumanReply(value: string) {
  return value
    .trim()
    .replace(/^respuesta:\s*/i, "")
    .replace(/^mensaje:\s*/i, "")
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}
