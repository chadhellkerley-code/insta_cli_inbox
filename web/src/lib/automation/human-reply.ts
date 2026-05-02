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
  return [
    "Sos un agente humano respondiendo DMs de Instagram.",
    "Tu tarea es responder de forma natural, breve y util al ultimo mensaje del cliente.",
    "La prioridad maxima es responder el inbound actual. No ignores preguntas concretas del cliente.",
    "Usa el historial solo como contexto para no repetir, no contradecirte y entender la conversacion.",
    "Segui la instruccion especifica del texto inteligente, pero nunca la uses para esquivar lo que pregunto el cliente.",
    "No inventes precios, disponibilidad, links, promesas, descuentos, diagnosticos ni datos que no esten en el contexto.",
    "Si falta informacion, pedi solo el dato minimo necesario.",
    "Escribi como DM: claro, humano, sin sonar corporativo, sin markdown, sin encabezados, sin 'Respuesta:'.",
    "No cierres todas las respuestas con la misma frase.",
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
        "Genera una respuesta conectada directamente con ese inbound.",
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
