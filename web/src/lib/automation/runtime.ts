import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AUTOMATION_AI_MODEL,
  decryptApiKey,
  loadAiCredential,
} from "@/lib/automation/ai-credentials";
import {
  CalendlyApiError,
  calendlyTokenNeedsRefresh,
  createCalendlyInviteeBooking,
  createCalendlySchedulingLink,
  listCalendlyAvailableTimes,
  refreshCalendlyToken,
} from "@/lib/calendly/oauth";
import { sendInstagramMessage } from "@/lib/meta/client";
import { assertInstagramAudioUrlAccessible } from "@/lib/meta/audio-url";
import {
  INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY,
  INSTAGRAM_MESSAGING_STATUS_READY,
} from "@/lib/meta/account-status";
import { ensureInstagramAccessToken } from "@/lib/meta/token-lifecycle";

type QueryClient = Pick<SupabaseClient, "from">;
const STAGE_MESSAGE_PART_GAP_MS = 1_000;
const STANDARD_MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_LIVE_REPLY_DELAY_SECONDS = 45;
const LIVE_STAGE_EXECUTION_BUDGET_MS = MAX_LIVE_REPLY_DELAY_SECONDS * 1000;

type AutomationAgentRuntimeRow = {
  id: string;
  owner_id: string;
  name: string;
  min_reply_delay_seconds: number;
  max_reply_delay_seconds: number;
  max_media_per_chat: number;
  is_active: boolean;
  ai_enabled: boolean;
  ai_prompt: string | null;
  personality: string | null;
};

type AutomationStageRuntimeRow = {
  id: string;
  agent_id: string;
  stage_order: number;
  name: string;
  auto_schedule_enabled: boolean | null;
  auto_schedule_mode: "link" | "auto_booking" | null;
};

type AutomationStageFollowupRuntimeRow = {
  id: string;
  stage_id: string;
  followup_order: number;
  is_active: boolean;
  delay_hours: number;
  message: string | null;
};

type AutomationStageMessageRuntimeRow = {
  id: string;
  stage_id: string;
  message_order: number;
  message_type: "text" | "audio" | "smart_text";
  text_content: string | null;
  media_url: string | null;
  generation_prompt: string | null;
  delay_seconds: number;
};

type AutomationRunRow = {
  id: string;
  owner_id: string;
  agent_id: string;
  account_id: string;
  conversation_id: string;
  last_completed_stage_order: number;
  active_stage_order: number | null;
  last_inbound_at: string | null;
  last_stage_scheduled_at: string | null;
  last_stage_completed_at: string | null;
  status: string;
};

type AutomationJobRow = {
  id: string;
  owner_id: string;
  agent_id: string;
  account_id: string;
  conversation_id: string;
  run_id: string;
  stage_id: string;
  stage_message_id: string | null;
  job_type:
    | "stage_message"
    | "followup"
    | "ai_reply"
    | "calendly_schedule"
    | "calendly_booking";
  status: "pending" | "processing" | "sent" | "skipped" | "failed" | "cancelled";
  scheduled_for: string;
  sent_at: string | null;
  attempt_count: number;
  last_error: string | null;
  payload: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type AutomationJobResult =
  | "sent"
  | "retry_scheduled"
  | "cancelled_inactive_agent"
  | "skipped_ai_disabled"
  | "skipped_followup_answered"
  | "skipped_missing_dependencies"
  | "skipped_outside_automation_window"
  | "skipped_calendly_unconfigured"
  | "failed";

type AutomationProcessingSummary = {
  claimed: number;
  sent: number;
  skipped: number;
  cancelled: number;
  retried: number;
  failed: number;
  cleaned: number;
};

type ConversationRuntimeRow = {
  id: string;
  owner_id: string;
  account_id: string;
  contact_igsid: string;
};

type AccountRuntimeRow = {
  id: string;
  owner_id: string;
  instagram_account_id: string;
  instagram_app_user_id: string | null;
  access_token: string;
  token_expires_at: string | null;
  token_lifecycle: string | null;
};

type CalendlyConnectionRuntimeRow = {
  calendly_user_uri: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

type CalendlySettingsRuntimeRow = {
  default_event_type_uri: string | null;
  default_event_type_name: string | null;
  enabled: boolean;
};

type ConversationMessageContextRow = {
  direction: "in" | "out";
  message_type: string;
  text_content: string | null;
  created_at: string | null;
};

type ConversationBookingIntentRow = {
  id: string;
  owner_id: string;
  account_id: string;
  conversation_id: string;
  run_id: string | null;
  agent_id: string | null;
  stage_id: string | null;
  job_id: string | null;
  event_type_uri: string | null;
  wants_booking: boolean | null;
  confirmed_time: boolean;
  proposed_start_time_local: string | null;
  timezone: string | null;
  invitee_name: string | null;
  invitee_email: string | null;
  alternatives: Array<{ startTime: string; localLabel: string }>;
  status: string;
  last_error: string | null;
  raw_extraction: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type ExtractedCalendlyBookingIntent = {
  wantsBooking: boolean;
  confirmedTime: boolean;
  startTimeLocal: string | null;
  timezone: string | null;
  email: string | null;
  name: string | null;
};

type GenerateAutomationReplyOptions = {
  apiKey: string;
  model?: string | null;
  aiPrompt: string | null;
  personality: string | null;
  generationPrompt?: string | null;
  inboundText: string;
  conversationMessages?: ConversationMessageContextRow[];
};

function castRows<T>(value: unknown) {
  return (value ?? []) as T[];
}

function castRow<T>(value: unknown) {
  return value as T | null;
}

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function isCalendlyAutoBookingEnabled() {
  return process.env.CALENDLY_AUTO_BOOKING_ENABLED === "true";
}

function normalizeEmail(value: string | null | undefined) {
  const email = normalizeOptionalString(value)?.toLowerCase() ?? null;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return email;
}

function isValidTimeZone(timezone: string | null | undefined) {
  if (!timezone) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getTimeZoneOffsetMs(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.get("year")),
    Number(values.get("month")) - 1,
    Number(values.get("day")),
    Number(values.get("hour")),
    Number(values.get("minute")),
    Number(values.get("second")),
  );

  return asUtc - date.getTime();
}

function parseLocalDateTime(value: string) {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second ?? 0),
  };
}

export function zonedLocalDateTimeToUtc(value: string, timezone: string) {
  const parsed = parseLocalDateTime(value);

  if (!parsed || !isValidTimeZone(timezone)) {
    return null;
  }

  const localAsUtc = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
  );
  let utcMs = localAsUtc;

  for (let index = 0; index < 3; index += 1) {
    utcMs = localAsUtc - getTimeZoneOffsetMs(new Date(utcMs), timezone);
  }

  const date = new Date(utcMs);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatBookingTime(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

function toMillis(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function randomInteger(min: number, max: number) {
  if (max <= min) {
    return min;
  }

  return min + Math.floor(Math.random() * (max - min + 1));
}

function clampLiveReplyDelaySeconds(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(MAX_LIVE_REPLY_DELAY_SECONDS, Math.max(0, Math.round(value)));
}

function buildAutomationAiSystemPrompt(options: Pick<
  GenerateAutomationReplyOptions,
  "aiPrompt" | "personality" | "generationPrompt"
>) {
  const parts = [
    "Responde como agente de atencion de Instagram.",
    "Devuelve solo el texto final para enviar al cliente.",
    normalizeOptionalString(options.personality)
      ? `Personalidad: ${normalizeOptionalString(options.personality)}`
      : null,
    normalizeOptionalString(options.aiPrompt)
      ? `Instrucciones: ${normalizeOptionalString(options.aiPrompt)}`
      : null,
    normalizeOptionalString(options.generationPrompt)
      ? [
          "Instruccion especifica de este mensaje:",
          normalizeOptionalString(options.generationPrompt),
        ].join(" ")
      : null,
  ].filter(Boolean);

  return parts.join("\n");
}

function buildAutomationAiMessages(options: GenerateAutomationReplyOptions) {
  const conversationMessages = options.conversationMessages ?? [];
  const messages = conversationMessages
    .map((message) => {
      const textContent = normalizeOptionalString(message.text_content);
      const sender = message.direction === "out" ? "El agente" : "El cliente";
      const content =
        textContent ??
        (message.message_type === "audio"
          ? `${sender} envio un audio.`
          : `${sender} envio un mensaje de tipo ${message.message_type || "desconocido"}.`);

      return {
        role: message.direction === "out" ? ("assistant" as const) : ("user" as const),
        content,
      };
    })
    .filter((message) => normalizeOptionalString(message.content));

  if (messages.length > 0) {
    return messages;
  }

  return [
    {
      role: "user" as const,
      content:
        normalizeOptionalString(options.inboundText) ?? "El cliente envio un mensaje sin texto.",
    },
  ];
}

function readChatCompletionContent(payload: unknown) {
  const content = (payload as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  })?.choices?.[0]?.message?.content;

  return normalizeOptionalString(typeof content === "string" ? content : null);
}

export async function generateAutomationReply(options: GenerateAutomationReplyOptions) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: normalizeOptionalString(options.model) ?? AUTOMATION_AI_MODEL,
      messages: [
        {
          role: "system",
          content: buildAutomationAiSystemPrompt(options),
        },
        ...buildAutomationAiMessages(options),
      ],
      temperature: 0.7,
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const errorMessage = (payload as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(errorMessage ?? `OpenAI respondio con HTTP ${response.status}.`);
  }

  const content = readChatCompletionContent(payload);

  if (!content) {
    throw new Error("OpenAI no devolvio contenido.");
  }

  return content;
}

function parseJsonObjectFromText(value: string) {
  const trimmed = value.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");

    if (start === -1 || end <= start) {
      throw new Error("La IA no devolvio JSON valido.");
    }

    return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
  }
}

function normalizeExtractedBookingIntent(payload: unknown): ExtractedCalendlyBookingIntent {
  const value = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};

  return {
    wantsBooking: value.wantsBooking === true,
    confirmedTime: value.confirmedTime === true,
    startTimeLocal:
      typeof value.startTimeLocal === "string" && value.startTimeLocal.trim()
        ? value.startTimeLocal.trim()
        : null,
    timezone:
      typeof value.timezone === "string" && value.timezone.trim()
        ? value.timezone.trim()
        : null,
    email:
      typeof value.email === "string" && value.email.trim()
        ? value.email.trim()
        : null,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim()
        : null,
  };
}

async function extractCalendlyBookingIntent(
  ownerId: string,
  conversationMessages: ConversationMessageContextRow[],
) {
  const credential = await loadAiCredential(ownerId);

  if (!credential) {
    return null;
  }

  const transcript = conversationMessages
    .map((message) => {
      const sender = message.direction === "out" ? "Agente" : "Lead";
      const text =
        normalizeOptionalString(message.text_content) ??
        `[${message.message_type || "mensaje sin texto"}]`;

      return `${sender} (${message.created_at ?? "sin fecha"}): ${text}`;
    })
    .join("\n");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${decryptApiKey(credential)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: normalizeOptionalString(credential.model) ?? AUTOMATION_AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Extrae intencion de reserva de una conversacion de Instagram.",
            "Devuelve solo JSON con estas claves exactas: wantsBooking, confirmedTime, startTimeLocal, timezone, email, name.",
            "startTimeLocal debe ser ISO local sin zona, por ejemplo 2026-05-03T17:00:00.",
            "Si no hay fecha y hora claras, startTimeLocal debe ser null y confirmedTime false.",
            "Si falta email, email debe ser null. No inventes emails.",
            "Si el timezone es ambiguo, timezone debe ser null. Si dice Argentina, usa America/Argentina/Buenos_Aires.",
            "confirmedTime solo debe ser true cuando el lead eligio o confirmo un horario concreto.",
            `Fecha actual de referencia: ${new Date().toISOString()}.`,
          ].join(" "),
        },
        {
          role: "user",
          content: transcript || "Sin mensajes recientes.",
        },
      ],
      temperature: 0,
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const errorMessage = (payload as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(errorMessage ?? `OpenAI respondio con HTTP ${response.status}.`);
  }

  const content = readChatCompletionContent(payload);

  if (!content) {
    throw new Error("OpenAI no devolvio contenido para extraer la agenda.");
  }

  const raw = parseJsonObjectFromText(content);

  return {
    intent: normalizeExtractedBookingIntent(raw),
    raw: raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {},
  };
}

async function generateAgentAiReply(
  agent: AutomationAgentRuntimeRow,
  ownerId: string,
  inboundText: string | null | undefined,
  conversationMessages?: ConversationMessageContextRow[],
) {
  if (!agent.ai_enabled) {
    return null;
  }

  const credential = await loadAiCredential(ownerId);

  if (!credential) {
    throw new Error("IA activada sin API key configurada.");
  }

  return generateAutomationReply({
    model: credential.model,
    apiKey: decryptApiKey(credential),
    aiPrompt: agent.ai_prompt,
    personality: agent.personality,
    inboundText: inboundText ?? "",
    conversationMessages,
  });
}

async function generateAgentSmartText(
  agent: AutomationAgentRuntimeRow,
  ownerId: string,
  generationPrompt: string,
  inboundText: string | null | undefined,
  conversationMessages?: ConversationMessageContextRow[],
) {
  const credential = await loadAiCredential(ownerId);

  if (!credential) {
    throw new Error("Texto inteligente sin API key configurada.");
  }

  return generateAutomationReply({
    model: credential.model,
    apiKey: decryptApiKey(credential),
    aiPrompt: agent.ai_prompt,
    personality: agent.personality,
    generationPrompt,
    inboundText: inboundText ?? "",
    conversationMessages,
  });
}

function createProcessingSummary(): AutomationProcessingSummary {
  return {
    claimed: 0,
    sent: 0,
    skipped: 0,
    cancelled: 0,
    retried: 0,
    failed: 0,
    cleaned: 0,
  };
}

function addJobResultToSummary(
  summary: AutomationProcessingSummary,
  result: AutomationJobResult,
) {
  switch (result) {
    case "sent":
      summary.sent += 1;
      break;
    case "retry_scheduled":
      summary.retried += 1;
      break;
    case "cancelled_inactive_agent":
      summary.cancelled += 1;
      break;
    case "skipped_followup_answered":
    case "skipped_ai_disabled":
    case "skipped_missing_dependencies":
    case "skipped_outside_automation_window":
    case "skipped_calendly_unconfigured":
      summary.skipped += 1;
      break;
    default:
      summary.failed += 1;
      break;
  }
}

function wait(milliseconds: number) {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getJobPayloadNumber(job: AutomationJobRow, key: string) {
  const value = job.payload?.[key];
  const numberValue = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getStageMessagePartOrder(job: AutomationJobRow) {
  return job.payload?.stageMessagePart === "audio" ? 1 : 0;
}

function compareNullableIso(left: string | null, right: string | null) {
  const leftMs = toMillis(left) ?? 0;
  const rightMs = toMillis(right) ?? 0;

  return leftMs - rightMs;
}

function getJobTypePriority(job: AutomationJobRow) {
  if (job.job_type === "stage_message") {
    return 0;
  }

  if (job.job_type === "followup") {
    return 2;
  }

  if (job.job_type === "calendly_schedule") {
    return 1;
  }

  if (job.job_type === "calendly_booking") {
    return 1;
  }

  return 2;
}

function compareDueAutomationJobs(left: AutomationJobRow, right: AutomationJobRow) {
  const scheduledDiff = compareNullableIso(left.scheduled_for, right.scheduled_for);

  if (scheduledDiff !== 0) {
    return scheduledDiff;
  }

  const stageOrderDiff =
    getJobPayloadNumber(left, "stageOrder") - getJobPayloadNumber(right, "stageOrder");

  if (stageOrderDiff !== 0) {
    return stageOrderDiff;
  }

  const typePriorityDiff = getJobTypePriority(left) - getJobTypePriority(right);

  if (typePriorityDiff !== 0) {
    return typePriorityDiff;
  }

  const messageOrderDiff =
    getJobPayloadNumber(left, "messageOrder") - getJobPayloadNumber(right, "messageOrder");

  if (messageOrderDiff !== 0) {
    return messageOrderDiff;
  }

  const partOrderDiff = getStageMessagePartOrder(left) - getStageMessagePartOrder(right);

  if (partOrderDiff !== 0) {
    return partOrderDiff;
  }

  return compareNullableIso(left.created_at, right.created_at);
}

function buildStageMessageJobPayloads(stageMessage: AutomationStageMessageRuntimeRow) {
  const textContent = normalizeOptionalString(stageMessage.text_content);
  const mediaUrl = normalizeOptionalString(stageMessage.media_url);
  const generationPrompt = normalizeOptionalString(stageMessage.generation_prompt);

  if (stageMessage.message_type === "smart_text") {
    return [
      {
        messageType: "smart_text" as const,
        textContent: null,
        mediaUrl: null,
        generationPrompt,
      },
    ];
  }

  if (stageMessage.message_type !== "audio") {
    return [
      {
        messageType: "text" as const,
        textContent,
        mediaUrl: null,
        generationPrompt: null,
      },
    ];
  }

  const parts: Array<{
    messageType: "text" | "audio" | "smart_text";
    textContent: string | null;
    mediaUrl: string | null;
    generationPrompt: string | null;
  }> = [];

  if (textContent) {
    parts.push({
      messageType: "text",
      textContent,
      mediaUrl: null,
      generationPrompt: null,
    });
  }

  parts.push({
    messageType: "audio",
    textContent: null,
    mediaUrl,
    generationPrompt: null,
  });

  return parts;
}

async function loadActiveAgent(client: QueryClient, ownerId: string) {
  const result = await client
    .from("automation_agents")
    .select(
      "id, owner_id, name, personality, min_reply_delay_seconds, max_reply_delay_seconds, max_media_per_chat, is_active, ai_enabled, ai_prompt",
    )
    .eq("owner_id", ownerId)
    .eq("is_active", true)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRow<AutomationAgentRuntimeRow>(result.data);
}

async function loadStagesForAgent(client: QueryClient, agentId: string) {
  const stagesResult = await client
    .from("automation_agent_stages")
    .select("id, agent_id, stage_order, name, auto_schedule_enabled, auto_schedule_mode")
    .eq("agent_id", agentId)
    .order("stage_order", { ascending: true });
  const stages = castRows<AutomationStageRuntimeRow>(stagesResult.data);

  if (stagesResult.error || stages.length === 0) {
    return {
      stages: [],
      followupsByStage: new Map<string, AutomationStageFollowupRuntimeRow[]>(),
      messagesByStage: new Map<string, AutomationStageMessageRuntimeRow[]>(),
    };
  }

  const stageIds = stages.map((stage) => stage.id);
  const followupsResult = await client
    .from("automation_stage_followups")
    .select("id, stage_id, followup_order, is_active, delay_hours, message")
    .in("stage_id", stageIds)
    .order("followup_order", { ascending: true });
  const followups = castRows<AutomationStageFollowupRuntimeRow>(followupsResult.data);
  const messagesResult = await client
    .from("automation_stage_messages")
    .select("id, stage_id, message_order, message_type, text_content, media_url, generation_prompt, delay_seconds")
    .in("stage_id", stageIds)
    .order("message_order", { ascending: true });
  const messages = castRows<AutomationStageMessageRuntimeRow>(messagesResult.data);

  if (messagesResult.error) {
    throw new Error(messagesResult.error.message);
  }
  if (followupsResult.error) {
    throw new Error(followupsResult.error.message);
  }

  const messagesByStage = new Map<string, AutomationStageMessageRuntimeRow[]>();
  const followupsByStage = new Map<string, AutomationStageFollowupRuntimeRow[]>();

  for (const message of messages) {
    const current = messagesByStage.get(message.stage_id) ?? [];
    current.push(message);
    messagesByStage.set(message.stage_id, current);
  }
  for (const followup of followups) {
    const current = followupsByStage.get(followup.stage_id) ?? [];
    current.push(followup);
    followupsByStage.set(followup.stage_id, current);
  }

  return {
    stages,
    followupsByStage,
    messagesByStage,
  };
}

async function upsertAutomationRun(
  client: QueryClient,
  options: {
    ownerId: string;
    agentId: string;
    accountId: string;
    conversationId: string;
    inboundAt: string;
  },
) {
  const existingResult = await client
    .from("automation_runs")
    .select("*")
    .eq("agent_id", options.agentId)
    .eq("conversation_id", options.conversationId)
    .maybeSingle();
  const existing = castRow<AutomationRunRow>(existingResult.data);

  if (existingResult.error) {
    throw new Error(existingResult.error.message);
  }

  if (!existing) {
    const insertResult = await client
      .from("automation_runs")
      .insert({
        owner_id: options.ownerId,
        agent_id: options.agentId,
        account_id: options.accountId,
        conversation_id: options.conversationId,
        last_inbound_at: options.inboundAt,
      } as never)
      .select("*")
      .maybeSingle();

    if (insertResult.error || !insertResult.data) {
      throw new Error(insertResult.error?.message ?? "No pudimos crear el seguimiento del agente.");
    }

    return castRow<AutomationRunRow>(insertResult.data)!;
  }

  const updateResult = await client
    .from("automation_runs")
    .update({
      last_inbound_at: options.inboundAt,
      status: existing.status === "completed" ? "active" : existing.status,
    } as never)
    .eq("id", existing.id)
    .select("*")
    .maybeSingle();

  if (updateResult.error || !updateResult.data) {
    throw new Error(updateResult.error?.message ?? "No pudimos actualizar el seguimiento del agente.");
  }

  return castRow<AutomationRunRow>(updateResult.data)!;
}

async function claimInboundForStage(
  client: QueryClient,
  options: {
    ownerId: string;
    runId: string;
    agentId: string;
    conversationId: string;
    inboundMessageId?: string | null;
    stageOrder: number | null | undefined;
  },
) {
  const inboundMessageId = normalizeOptionalString(options.inboundMessageId);

  if (!inboundMessageId) {
    return { claimed: true as const };
  }

  const stageOrder = options.stageOrder ?? 1;
  const insertResult = await client.from("automation_inbound_stage_claims").insert({
    owner_id: options.ownerId,
    run_id: options.runId,
    agent_id: options.agentId,
    conversation_id: options.conversationId,
    inbound_message_id: inboundMessageId,
    stage_order: Math.max(1, stageOrder),
  } as never);

  if (!insertResult.error) {
    return { claimed: true as const };
  }

  if (insertResult.error.code === "23505") {
    return { claimed: false as const };
  }

  throw new Error(insertResult.error.message);
}

async function countSentAudioJobs(client: QueryClient, runId: string) {
  const result = await client
    .from("automation_jobs")
    .select("payload")
    .eq("run_id", runId)
    .eq("status", "sent")
    .eq("job_type", "stage_message");
  const rows = castRows<{ payload: Record<string, unknown> | null }>(result.data);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return rows.filter((row) => row.payload?.messageType === "audio").length;
}

async function hasPendingStageMessages(client: QueryClient, runId: string) {
  const result = await client
    .from("automation_jobs")
    .select("id")
    .eq("run_id", runId)
    .eq("job_type", "stage_message")
    .in("status", ["pending", "processing"])
    .limit(1);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRows<{ id: string }>(result.data).length > 0;
}

async function markRunCompleted(client: QueryClient, runId: string) {
  await client
    .from("automation_runs")
    .update({
      active_stage_order: null,
      status: "completed",
    } as never)
    .eq("id", runId);
}

async function cancelAnsweredPendingResponseJobs(
  client: QueryClient,
  options: {
    runId: string;
    inboundAt: string;
  },
) {
  const result = await client
    .from("automation_jobs")
    .update({
      status: "cancelled",
      last_error: "El cliente respondio antes de que se envie esta respuesta.",
    } as never)
    .eq("run_id", options.runId)
    .in("job_type", ["followup", "ai_reply", "calendly_schedule", "calendly_booking"])
    .eq("status", "pending")
    .lt("created_at", options.inboundAt);

  if (result.error) {
    throw new Error(result.error.message);
  }
}

function isOpenBookingIntentStatus(status: string | null | undefined) {
  return [
    "collecting",
    "awaiting_email",
    "awaiting_time",
    "awaiting_timezone",
    "awaiting_confirmation",
    "offered_alternatives",
  ].includes(status ?? "");
}

async function loadOpenBookingIntent(
  client: QueryClient,
  options: {
    ownerId: string;
    conversationId: string;
  },
) {
  const result = await client
    .from("conversation_booking_intents")
    .select("*")
    .eq("owner_id", options.ownerId)
    .eq("conversation_id", options.conversationId)
    .in("status", [
      "collecting",
      "awaiting_email",
      "awaiting_time",
      "awaiting_timezone",
      "awaiting_confirmation",
      "offered_alternatives",
    ])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRow<ConversationBookingIntentRow>(result.data);
}

async function scheduleOpenBookingIntentJob(
  client: QueryClient,
  intent: ConversationBookingIntentRow,
  inboundText: string | null | undefined,
) {
  if (!intent.agent_id || !intent.stage_id || !intent.run_id) {
    return null;
  }

  const scheduledFor = new Date().toISOString();
  const insertResult = await client
    .from("automation_jobs")
    .insert({
      owner_id: intent.owner_id,
      agent_id: intent.agent_id,
      account_id: intent.account_id,
      conversation_id: intent.conversation_id,
      run_id: intent.run_id,
      stage_id: intent.stage_id,
      stage_message_id: null,
      job_type: "calendly_booking",
      status: "pending",
      scheduled_for: scheduledFor,
      payload: {
        messageType: "text",
        bookingIntentId: intent.id,
        inboundText: inboundText ?? null,
      },
    } as never)
    .select("id")
    .maybeSingle();

  if (insertResult.error || !insertResult.data) {
    throw new Error(insertResult.error?.message ?? "No pudimos agendar la reserva de Calendly.");
  }

  const jobId = (insertResult.data as { id: string }).id;
  const updateIntent = await client
    .from("conversation_booking_intents")
    .update({
      job_id: jobId,
      status: "collecting",
      last_error: null,
    } as never)
    .eq("id", intent.id);

  if (updateIntent.error) {
    throw new Error(updateIntent.error.message);
  }

  return { jobId, scheduledFor };
}

export async function scheduleAutomationForInboundMessage(
  client: QueryClient,
  options: {
    ownerId: string;
    accountId: string;
    conversationId: string;
    createdAt: string;
    isInbound: boolean;
    inboundMessageId?: string | null;
    inboundText?: string | null;
  },
) {
  if (!options.isInbound) {
    return { scheduled: 0, reason: "not_inbound" as const };
  }

  const agent = await loadActiveAgent(client, options.ownerId);

  if (!agent) {
    return { scheduled: 0, reason: "no_active_agent" as const };
  }

  const { stages, followupsByStage, messagesByStage } = await loadStagesForAgent(client, agent.id);

  if (stages.length === 0) {
    return { scheduled: 0, reason: "no_stages" as const };
  }

  const run = await upsertAutomationRun(client, {
    ownerId: options.ownerId,
    agentId: agent.id,
    accountId: options.accountId,
    conversationId: options.conversationId,
    inboundAt: options.createdAt,
  });

  await cancelAnsweredPendingResponseJobs(client, {
    runId: run.id,
    inboundAt: options.createdAt,
  });

  const openBookingIntent = isCalendlyAutoBookingEnabled()
    ? await loadOpenBookingIntent(client, {
        ownerId: options.ownerId,
        conversationId: options.conversationId,
      })
    : null;

  if (
    openBookingIntent &&
    isOpenBookingIntentStatus(openBookingIntent.status) &&
    openBookingIntent.agent_id &&
    openBookingIntent.stage_id &&
    openBookingIntent.run_id
  ) {
    const claim = await claimInboundForStage(client, {
      ownerId: options.ownerId,
      runId: openBookingIntent.run_id,
      agentId: openBookingIntent.agent_id,
      conversationId: options.conversationId,
      inboundMessageId: options.inboundMessageId,
      stageOrder: run.active_stage_order ?? run.last_completed_stage_order,
    });

    if (!claim.claimed) {
      return { scheduled: 0, reason: "duplicate_inbound" as const };
    }

    const bookingJob = await scheduleOpenBookingIntentJob(
      client,
      openBookingIntent,
      options.inboundText,
    );

    if (bookingJob && openBookingIntent.stage_id) {
      return {
        scheduled: 1,
        calendlyBookingJobs: 1,
        reason: "scheduled" as const,
        runId: openBookingIntent.run_id ?? run.id,
        stageId: openBookingIntent.stage_id,
        stageOrder: run.active_stage_order ?? run.last_completed_stage_order,
      };
    }
  }

  if (await hasPendingStageMessages(client, run.id)) {
    return { scheduled: 0, reason: "stage_in_progress" as const };
  }

  const nextStageOrder = (run.last_completed_stage_order ?? 0) + 1;
  const nextStage = stages.find((stage) => stage.stage_order === nextStageOrder);

  if (!nextStage) {
    await markRunCompleted(client, run.id);

    return {
      scheduled: 0,
      reason: "flow_completed" as const,
    };
  }

  const claim = await claimInboundForStage(client, {
    ownerId: options.ownerId,
    runId: run.id,
    agentId: agent.id,
    conversationId: options.conversationId,
    inboundMessageId: options.inboundMessageId,
    stageOrder: nextStage.stage_order,
  });

  if (!claim.claimed) {
    return { scheduled: 0, reason: "duplicate_inbound" as const };
  }

  const sentAudioJobs = await countSentAudioJobs(client, run.id);
  const stageMessages = messagesByStage.get(nextStage.id) ?? [];
  const createdAtMs = toMillis(options.createdAt) ?? Date.now();
  const minReplyDelaySeconds = clampLiveReplyDelaySeconds(agent.min_reply_delay_seconds);
  const maxReplyDelaySeconds = Math.max(
    minReplyDelaySeconds,
    clampLiveReplyDelaySeconds(agent.max_reply_delay_seconds),
  );
  const startAtMs = Math.max(
    Date.now(),
    createdAtMs + randomInteger(minReplyDelaySeconds, maxReplyDelaySeconds) * 1000,
  );
  let scheduledAtMs = startAtMs;
  let insertedCount = 0;
  let insertedStageMessageCount = 0;
  let insertedFollowupCount = 0;
  let insertedCalendlyScheduleCount = 0;
  let usedAudio = sentAudioJobs;
  let lastScheduledIso = new Date(startAtMs).toISOString();
  let lastInsertedDelaySeconds = 0;

  for (const stageMessage of stageMessages) {
    if (stageMessage.message_type === "audio" && usedAudio >= agent.max_media_per_chat) {
      continue;
    }

    if (insertedCount > 0) {
      scheduledAtMs += lastInsertedDelaySeconds * 1000;
    }

    lastScheduledIso = new Date(scheduledAtMs).toISOString();

    const jobPayloads = buildStageMessageJobPayloads(stageMessage);
    let lastPartScheduledAtMs = scheduledAtMs;

    for (let payloadIndex = 0; payloadIndex < jobPayloads.length; payloadIndex += 1) {
      const payload = jobPayloads[payloadIndex];
      const partScheduledAtMs = scheduledAtMs + payloadIndex * STAGE_MESSAGE_PART_GAP_MS;
      lastPartScheduledAtMs = partScheduledAtMs;
      lastScheduledIso = new Date(partScheduledAtMs).toISOString();

      const insertResult = await client.from("automation_jobs").insert({
        owner_id: options.ownerId,
        agent_id: agent.id,
        account_id: options.accountId,
        conversation_id: options.conversationId,
        run_id: run.id,
        stage_id: nextStage.id,
        stage_message_id: stageMessage.id,
        job_type: "stage_message",
        status: "pending",
        scheduled_for: lastScheduledIso,
        payload: {
          stageOrder: nextStage.stage_order,
          stageName: nextStage.name,
          messageOrder: stageMessage.message_order,
          messageType: payload.messageType,
          textContent: payload.textContent,
          mediaUrl: payload.mediaUrl,
          generationPrompt: payload.generationPrompt,
          inboundText: options.inboundText ?? null,
          stageMessageType: stageMessage.message_type,
          stageMessagePart:
            payload.messageType === "text" && stageMessage.message_type === "audio"
              ? "audio_text"
              : payload.messageType,
        },
      } as never);

      if (insertResult.error) {
        throw new Error(insertResult.error.message);
      }

      insertedCount += 1;
      insertedStageMessageCount += 1;
    }

    if (stageMessage.message_type === "audio") {
      usedAudio += 1;
    }

    scheduledAtMs =
      lastPartScheduledAtMs + (jobPayloads.length > 1 ? STAGE_MESSAGE_PART_GAP_MS : 0);

    lastInsertedDelaySeconds = stageMessage.delay_seconds;
  }

  if (insertedCount === 0) {
    return { scheduled: 0, reason: "no_deliverable_messages" as const };
  }

  if (nextStage.auto_schedule_enabled) {
    const calendlyScheduledFor = new Date(scheduledAtMs).toISOString();
    const calendlyJobType =
      isCalendlyAutoBookingEnabled() && nextStage.auto_schedule_mode === "auto_booking"
        ? "calendly_booking"
        : "calendly_schedule";
    const insertCalendlySchedule = await client.from("automation_jobs").insert({
      owner_id: options.ownerId,
      agent_id: agent.id,
      account_id: options.accountId,
      conversation_id: options.conversationId,
      run_id: run.id,
      stage_id: nextStage.id,
      stage_message_id: null,
      job_type: calendlyJobType,
      status: "pending",
      scheduled_for: calendlyScheduledFor,
      payload: {
        stageOrder: nextStage.stage_order,
        stageName: nextStage.name,
        messageType: "text",
        calendlyMode: calendlyJobType === "calendly_booking" ? "auto_booking" : "link",
      },
    } as never);

    if (insertCalendlySchedule.error) {
      throw new Error(insertCalendlySchedule.error.message);
    }

    insertedCount += 1;
    insertedCalendlyScheduleCount += 1;
  }

  const followups = (followupsByStage.get(nextStage.id) ?? [])
    .filter((followup) => followup.is_active && normalizeOptionalString(followup.message))
    .sort((left, right) => left.followup_order - right.followup_order);

  for (const followup of followups) {
    const followupScheduledFor = new Date(
      scheduledAtMs + followup.delay_hours * 60 * 60 * 1000,
    ).toISOString();
    const insertFollowup = await client.from("automation_jobs").insert({
      owner_id: options.ownerId,
      agent_id: agent.id,
      account_id: options.accountId,
      conversation_id: options.conversationId,
      run_id: run.id,
      stage_id: nextStage.id,
      stage_message_id: null,
      job_type: "followup",
      status: "pending",
      scheduled_for: followupScheduledFor,
      payload: {
        stageOrder: nextStage.stage_order,
        stageName: nextStage.name,
        followupOrder: followup.followup_order,
        messageType: "text",
        textContent: followup.message,
      },
    } as never);

    if (insertFollowup.error) {
      throw new Error(insertFollowup.error.message);
    }

    insertedCount += 1;
    insertedFollowupCount += 1;
  }

  await client
    .from("automation_runs")
    .update({
      active_stage_order: nextStage.stage_order,
      last_stage_scheduled_at: lastScheduledIso,
      status: "active",
    } as never)
    .eq("id", run.id);

  return {
    scheduled: insertedCount,
    stageMessageJobs: insertedStageMessageCount,
    followupJobs: insertedFollowupCount,
    calendlyScheduleJobs: insertedCalendlyScheduleCount,
    reason: "scheduled" as const,
    runId: run.id,
    stageId: nextStage.id,
    stageOrder: nextStage.stage_order,
  };
}

async function claimPendingJob(client: QueryClient, jobId: string) {
  const result = await client
    .from("automation_jobs")
    .update({
      status: "processing",
    } as never)
    .eq("id", jobId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRow<AutomationJobRow>(result.data);
}

async function markJob(
  client: QueryClient,
  jobId: string,
  values: Partial<AutomationJobRow>,
) {
  const result = await client
    .from("automation_jobs")
    .update(values as never)
    .eq("id", jobId);

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function loadRun(client: QueryClient, runId: string) {
  const result = await client
    .from("automation_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRow<AutomationRunRow>(result.data);
}

async function loadConversation(client: QueryClient, conversationId: string) {
  const result = await client
    .from("instagram_conversations")
    .select("id, owner_id, account_id, contact_igsid")
    .eq("id", conversationId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRow<ConversationRuntimeRow>(result.data);
}

async function loadAccount(client: QueryClient, accountId: string) {
  const result = await client
    .from("instagram_accounts")
    .select(
      "id, owner_id, instagram_account_id, instagram_app_user_id, access_token, token_expires_at, token_lifecycle",
    )
    .eq("id", accountId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRow<AccountRuntimeRow>(result.data);
}

async function loadRecentConversationMessages(client: QueryClient, conversationId: string) {
  const result = await client
    .from("instagram_messages")
    .select("direction, message_type, text_content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRows<ConversationMessageContextRow>(result.data).reverse();
}

async function loadAgent(client: QueryClient, agentId: string) {
  const result = await client
    .from("automation_agents")
    .select(
      "id, owner_id, name, personality, min_reply_delay_seconds, max_reply_delay_seconds, max_media_per_chat, is_active, ai_enabled, ai_prompt",
    )
    .eq("id", agentId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRow<AutomationAgentRuntimeRow>(result.data);
}

async function loadCalendlySettings(client: QueryClient, ownerId: string) {
  const result = await client
    .from("calendly_settings")
    .select("default_event_type_uri, default_event_type_name, enabled")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRow<CalendlySettingsRuntimeRow>(result.data);
}

async function loadFreshCalendlyConnection(client: QueryClient, ownerId: string) {
  const result = await client
    .from("calendly_connections")
    .select("calendly_user_uri, access_token, refresh_token, expires_at")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  const connection = castRow<CalendlyConnectionRuntimeRow>(result.data);

  if (!connection) {
    return null;
  }

  if (!calendlyTokenNeedsRefresh(connection.expires_at)) {
    return connection;
  }

  const refreshedTokens = await refreshCalendlyToken(connection.refresh_token);
  const updateResult = await client
    .from("calendly_connections")
    .update({
      access_token: refreshedTokens.accessToken,
      refresh_token: refreshedTokens.refreshToken,
      expires_at: refreshedTokens.expiresAt,
    } as never)
    .eq("owner_id", ownerId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  return {
    ...connection,
    access_token: refreshedTokens.accessToken,
    refresh_token: refreshedTokens.refreshToken,
    expires_at: refreshedTokens.expiresAt,
  };
}

async function countRemainingStageMessageJobs(
  client: QueryClient,
  runId: string,
  stageId: string,
) {
  const result = await client
    .from("automation_jobs")
    .select("id")
    .eq("run_id", runId)
    .eq("stage_id", stageId)
    .eq("job_type", "stage_message")
    .in("status", ["pending", "processing"])
    .limit(1);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRows<{ id: string }>(result.data).length;
}

async function loadLastStageOrder(client: QueryClient, agentId: string) {
  const result = await client
    .from("automation_agent_stages")
    .select("stage_order")
    .eq("agent_id", agentId)
    .order("stage_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  const stage = castRow<{ stage_order: number }>(result.data);
  return stage?.stage_order ?? null;
}

async function maybeCompleteStage(
  client: QueryClient,
  run: AutomationRunRow,
  job: AutomationJobRow,
  completedAt: string,
) {
  const remainingJobs = await countRemainingStageMessageJobs(client, run.id, job.stage_id);

  if (remainingJobs > 0) {
    return;
  }

  const stageOrder =
    typeof job.payload?.stageOrder === "number"
      ? job.payload.stageOrder
      : Number(job.payload?.stageOrder ?? 0);
  const completedStageOrder = Number.isFinite(stageOrder)
    ? stageOrder
    : run.last_completed_stage_order;
  const lastStageOrder = await loadLastStageOrder(client, run.agent_id);
  const flowCompleted =
    lastStageOrder !== null && completedStageOrder >= lastStageOrder;

  await client
    .from("automation_runs")
    .update({
      last_completed_stage_order: completedStageOrder,
      active_stage_order: null,
      last_stage_completed_at: completedAt,
      status: flowCompleted ? "completed" : "active",
    } as never)
    .eq("id", run.id);
}

async function sendAutomationOutboundMessage(
  client: QueryClient,
  conversation: ConversationRuntimeRow,
  account: AccountRuntimeRow,
  options: {
    messageType: "text" | "audio";
    textContent: string | null;
    mediaUrl: string | null;
  },
) {
  const managedToken = await ensureInstagramAccessToken({
    accessToken: account.access_token,
    expiresAt: account.token_expires_at,
    lifecycle: account.token_lifecycle,
    onTokenUpdate: async (nextToken) => {
      const updateTokenResult = await client
        .from("instagram_accounts")
        .update({
          access_token: nextToken.accessToken,
          expires_in: nextToken.expiresIn,
          expires_at: nextToken.expiresAt,
          token_expires_at: nextToken.expiresAt,
          token_obtained_at: nextToken.obtainedAt,
          token_lifecycle: nextToken.lifecycle,
          last_token_refresh_at: nextToken.obtainedAt,
          updated_at: nextToken.obtainedAt,
        } as never)
        .eq("id", account.id);

      if (updateTokenResult.error) {
        throw new Error(updateTokenResult.error.message);
      }

      account.access_token = nextToken.accessToken;
      account.token_expires_at = nextToken.expiresAt;
      account.token_lifecycle = nextToken.lifecycle;
    },
  });
  const messageType = options.messageType;
  const textContent = normalizeOptionalString(options.textContent);
  const mediaUrl = normalizeOptionalString(options.mediaUrl);

  if (messageType === "text" && !textContent) {
    throw new Error("El mensaje no tiene contenido de texto.");
  }

  if (messageType === "audio" && !mediaUrl) {
    throw new Error("El mensaje de audio no tiene media_url.");
  }

  if (messageType === "audio" && mediaUrl) {
    await assertInstagramAudioUrlAccessible(mediaUrl);
  }

  const response = await sendInstagramMessage({
    accessToken: managedToken.accessToken,
    recipientId: conversation.contact_igsid,
    text: textContent ?? undefined,
    messageType: messageType === "audio" ? "audio" : undefined,
    mediaUrl: mediaUrl ?? undefined,
  });
  const nowIso = new Date().toISOString();
  const preview = textContent ?? (messageType === "audio" ? "Mensaje de audio" : "Mensaje");
  const scopedMetaMessageId = response.message_id
    ? `${conversation.account_id}:${response.message_id}`
    : crypto.randomUUID();

  const messageInsert = await client.from("instagram_messages").insert({
    owner_id: conversation.owner_id,
    account_id: conversation.account_id,
    conversation_id: conversation.id,
    meta_message_id: scopedMetaMessageId,
    direction: "out",
    message_type: messageType,
    text_content: textContent,
    media_url: mediaUrl,
    sender_igsid: account.instagram_app_user_id ?? account.instagram_account_id,
    recipient_igsid: conversation.contact_igsid,
    raw_payload: response,
    sent_at: nowIso,
    created_at: nowIso,
  } as never);

  if (messageInsert.error) {
    throw new Error(messageInsert.error.message);
  }

  const conversationUpdate = await client
    .from("instagram_conversations")
    .update({
      last_message_text: preview,
      last_message_type: messageType,
      last_message_at: nowIso,
      unread_count: 0,
      updated_at: nowIso,
    } as never)
    .eq("id", conversation.id);

  if (conversationUpdate.error) {
    throw new Error(conversationUpdate.error.message);
  }

  await client
    .from("instagram_accounts")
    .update({
      messaging_status: INSTAGRAM_MESSAGING_STATUS_READY,
      status: INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY,
      webhook_subscription_error: null,
      updated_at: nowIso,
    } as never)
    .eq("id", account.id);

  return {
    sentAt: nowIso,
  };
}

function buildCalendlyScheduleMessage(options: {
  bookingUrl: string;
  eventTypeName: string | null;
}) {
  const eventTypeName = normalizeOptionalString(options.eventTypeName);

  return eventTypeName
    ? `Ya esta todo listo para agendar ${eventTypeName}. Elegi tu horario aca: ${options.bookingUrl}`
    : `Ya esta todo listo para agendar. Elegi tu horario aca: ${options.bookingUrl}`;
}

async function sendCalendlyScheduleJob(
  client: QueryClient,
  job: AutomationJobRow,
  conversation: ConversationRuntimeRow,
  account: AccountRuntimeRow,
) {
  const [settings, connection] = await Promise.all([
    loadCalendlySettings(client, job.owner_id),
    loadFreshCalendlyConnection(client, job.owner_id),
  ]);
  const eventTypeUri = normalizeOptionalString(settings?.default_event_type_uri);

  if (!settings?.enabled || !eventTypeUri || !connection) {
    await markJob(client, job.id, {
      status: "skipped",
      last_error:
        "Agenda automatica activa, pero Calendly no esta conectado o no tiene reunion por defecto.",
    });
    return { sent: false, skipped: "calendly_unconfigured" as const };
  }

  const schedulingLink = await createCalendlySchedulingLink({
    accessToken: connection.access_token,
    eventTypeUri,
  });
  const textContent = buildCalendlyScheduleMessage({
    bookingUrl: schedulingLink.bookingUrl,
    eventTypeName: settings.default_event_type_name,
  });
  const result = await sendAutomationOutboundMessage(client, conversation, account, {
    messageType: "text",
    textContent,
    mediaUrl: null,
  });

  await markJob(client, job.id, {
    status: "sent",
    sent_at: result.sentAt,
    attempt_count: (job.attempt_count ?? 0) + 1,
    last_error: null,
    payload: {
      ...(job.payload ?? {}),
      calendlyEventTypeUri: eventTypeUri,
      calendlyEventTypeName: settings.default_event_type_name,
      calendlyBookingUrl: schedulingLink.bookingUrl,
      textContent,
    },
  });

  return { sent: true };
}

async function upsertConversationBookingIntent(
  client: QueryClient,
  job: AutomationJobRow,
  values: Partial<ConversationBookingIntentRow>,
) {
  const payload = {
    owner_id: job.owner_id,
    account_id: job.account_id,
    conversation_id: job.conversation_id,
    run_id: job.run_id,
    agent_id: job.agent_id,
    stage_id: job.stage_id,
    job_id: job.id,
    ...values,
  };
  const result = await client
    .from("conversation_booking_intents")
    .upsert(payload as never, { onConflict: "owner_id,conversation_id" })
    .select("*")
    .maybeSingle();

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "No pudimos guardar la intencion de agenda.");
  }

  return castRow<ConversationBookingIntentRow>(result.data)!;
}

async function sendCalendlyBookingPrompt(
  client: QueryClient,
  job: AutomationJobRow,
  conversation: ConversationRuntimeRow,
  account: AccountRuntimeRow,
  textContent: string,
  status: string,
  lastError: string | null = null,
) {
  const result = await sendAutomationOutboundMessage(client, conversation, account, {
    messageType: "text",
    textContent,
    mediaUrl: null,
  });

  await markJob(client, job.id, {
    status: "sent",
    sent_at: result.sentAt,
    attempt_count: (job.attempt_count ?? 0) + 1,
    last_error: lastError,
    payload: {
      ...(job.payload ?? {}),
      textContent,
      calendlyBookingStatus: status,
    },
  });

  await upsertConversationBookingIntent(client, job, {
    status,
    last_error: lastError,
  });

  return { sent: true };
}

function isCalendlyPermissionError(error: unknown) {
  return error instanceof CalendlyApiError && (error.status === 401 || error.status === 403);
}

function isCalendlyValidationError(error: unknown) {
  return error instanceof CalendlyApiError && error.status >= 400 && error.status < 500;
}

function findExactAvailableTime(
  availableTimes: Array<{ startTime: string }>,
  requestedStartTime: string,
) {
  const requestedMs = new Date(requestedStartTime).getTime();

  return availableTimes.find((availableTime) => {
    const availableMs = new Date(availableTime.startTime).getTime();
    return Number.isFinite(availableMs) && Math.abs(availableMs - requestedMs) < 60_000;
  }) ?? null;
}

function buildAvailabilityWindow(requestedStart: Date) {
  return {
    startTime: new Date(requestedStart.getTime() - 12 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(requestedStart.getTime() + 36 * 60 * 60 * 1000).toISOString(),
  };
}

function buildAlternativeSlots(
  availableTimes: Array<{ startTime: string }>,
  requestedStart: Date,
  timezone: string,
) {
  return availableTimes
    .map((availableTime) => ({
      startTime: availableTime.startTime,
      startMs: new Date(availableTime.startTime).getTime(),
    }))
    .filter((availableTime) => Number.isFinite(availableTime.startMs))
    .sort(
      (left, right) =>
        Math.abs(left.startMs - requestedStart.getTime()) -
        Math.abs(right.startMs - requestedStart.getTime()),
    )
    .slice(0, 3)
    .map((availableTime) => ({
      startTime: availableTime.startTime,
      localLabel: formatBookingTime(new Date(availableTime.startTime), timezone),
    }));
}

function buildAlternativesMessage(alternatives: Array<{ localLabel: string }>) {
  if (alternatives.length === 0) {
    return "Ese horario no aparece disponible. Pasame otro horario y lo reviso.";
  }

  return [
    "Ese horario no aparece disponible. Tengo estas alternativas:",
    ...alternatives.map((alternative) => `- ${alternative.localLabel}`),
    "Decime cual te sirve y lo agendo.",
  ].join("\n");
}

async function persistCalendlyBooking(
  client: QueryClient,
  job: AutomationJobRow,
  options: {
    eventTypeUri: string;
    booking: Awaited<ReturnType<typeof createCalendlyInviteeBooking>>;
  },
) {
  const insertResult = await client.from("calendly_bookings").insert({
    owner_id: job.owner_id,
    account_id: job.account_id,
    conversation_id: job.conversation_id,
    run_id: job.run_id,
    job_id: job.id,
    event_type_uri: options.eventTypeUri,
    event_uri: options.booking.eventUri,
    invitee_uri: options.booking.uri,
    invitee_name: options.booking.name,
    invitee_email: options.booking.email,
    timezone: options.booking.timezone,
    start_time: options.booking.startTime,
    cancel_url: options.booking.cancelUrl,
    reschedule_url: options.booking.rescheduleUrl,
    status: options.booking.status ?? "created",
    raw_payload: options.booking.rawPayload,
  } as never);

  if (insertResult.error) {
    throw new Error(insertResult.error.message);
  }
}

async function sendCalendlyBookingJob(
  client: QueryClient,
  job: AutomationJobRow,
  conversation: ConversationRuntimeRow,
  account: AccountRuntimeRow,
) {
  if (!isCalendlyAutoBookingEnabled()) {
    return sendCalendlyScheduleJob(client, job, conversation, account);
  }

  const [settings, connection, conversationMessages] = await Promise.all([
    loadCalendlySettings(client, job.owner_id),
    loadFreshCalendlyConnection(client, job.owner_id),
    loadRecentConversationMessages(client, conversation.id),
  ]);
  const eventTypeUri = normalizeOptionalString(settings?.default_event_type_uri);

  if (!settings?.enabled || !eventTypeUri || !connection) {
    return sendCalendlyScheduleJob(client, job, conversation, account);
  }

  const extraction = await extractCalendlyBookingIntent(job.owner_id, conversationMessages);

  if (!extraction) {
    await upsertConversationBookingIntent(client, job, {
      event_type_uri: eventTypeUri,
      status: "fallback_link",
      last_error: "No hay credenciales de IA para extraer la agenda.",
    });
    return sendCalendlyScheduleJob(client, job, conversation, account);
  }

  const intent = extraction.intent;
  const email = normalizeEmail(intent.email);
  const name = normalizeOptionalString(intent.name) ?? "Invitado";
  const startTimeLocal = normalizeOptionalString(intent.startTimeLocal);
  const timezone = normalizeOptionalString(intent.timezone);

  await upsertConversationBookingIntent(client, job, {
    event_type_uri: eventTypeUri,
    wants_booking: intent.wantsBooking,
    confirmed_time: intent.confirmedTime,
    proposed_start_time_local: startTimeLocal,
    timezone,
    invitee_name: name,
    invitee_email: email,
    status: "collecting",
    last_error: null,
    raw_extraction: extraction.raw,
  });

  if (!intent.wantsBooking) {
    return sendCalendlyBookingPrompt(
      client,
      job,
      conversation,
      account,
      "Para agendar necesito que me confirmes un horario.",
      "awaiting_time",
    );
  }

  if (!startTimeLocal) {
    return sendCalendlyBookingPrompt(
      client,
      job,
      conversation,
      account,
      "Pasame dia y hora exactos para agendar.",
      "awaiting_time",
    );
  }

  if (!timezone || !isValidTimeZone(timezone)) {
    return sendCalendlyBookingPrompt(
      client,
      job,
      conversation,
      account,
      "Confirmame tambien en que zona horaria estas para agendar bien el horario.",
      "awaiting_timezone",
    );
  }

  const requestedStart = zonedLocalDateTimeToUtc(startTimeLocal, timezone);

  if (!requestedStart) {
    return sendCalendlyBookingPrompt(
      client,
      job,
      conversation,
      account,
      "No pude interpretar bien ese horario. Pasamelo con dia, hora y zona horaria.",
      "awaiting_time",
      "Horario invalido.",
    );
  }

  if (requestedStart.getTime() <= Date.now()) {
    return sendCalendlyBookingPrompt(
      client,
      job,
      conversation,
      account,
      "Ese horario ya paso. Pasame otro horario y lo agendo.",
      "awaiting_time",
      "Horario en el pasado.",
    );
  }

  if (!email) {
    return sendCalendlyBookingPrompt(
      client,
      job,
      conversation,
      account,
      "Perfecto. Pasame tu email para dejar la reunion agendada.",
      "awaiting_email",
    );
  }

  if (!intent.confirmedTime) {
    return sendCalendlyBookingPrompt(
      client,
      job,
      conversation,
      account,
      `Confirmame si queres que lo agende para ${formatBookingTime(requestedStart, timezone)}.`,
      "awaiting_confirmation",
    );
  }

  try {
    const availabilityWindow = buildAvailabilityWindow(requestedStart);
    const availableTimes = await listCalendlyAvailableTimes({
      accessToken: connection.access_token,
      eventTypeUri,
      startTime: availabilityWindow.startTime,
      endTime: availabilityWindow.endTime,
    });
    const exactSlot = findExactAvailableTime(availableTimes, requestedStart.toISOString());

    if (!exactSlot) {
      const alternatives = buildAlternativeSlots(availableTimes, requestedStart, timezone);
      const textContent = buildAlternativesMessage(alternatives);
      const result = await sendAutomationOutboundMessage(client, conversation, account, {
        messageType: "text",
        textContent,
        mediaUrl: null,
      });

      await upsertConversationBookingIntent(client, job, {
        event_type_uri: eventTypeUri,
        alternatives,
        status: "offered_alternatives",
        last_error: "Horario ocupado.",
      });
      await markJob(client, job.id, {
        status: "sent",
        sent_at: result.sentAt,
        attempt_count: (job.attempt_count ?? 0) + 1,
        last_error: "Horario ocupado.",
        payload: {
          ...(job.payload ?? {}),
          textContent,
          calendlyAlternatives: alternatives,
        },
      });

      return { sent: true };
    }

    const booking = await createCalendlyInviteeBooking({
      accessToken: connection.access_token,
      eventTypeUri,
      startTime: requestedStart.toISOString(),
      invitee: {
        name,
        email,
        timezone,
      },
    });
    await persistCalendlyBooking(client, job, {
      eventTypeUri,
      booking,
    });
    const textContent = `Listo, quedo agendado para ${formatBookingTime(requestedStart, timezone)}. Te va a llegar la invitacion al email.`;
    const result = await sendAutomationOutboundMessage(client, conversation, account, {
      messageType: "text",
      textContent,
      mediaUrl: null,
    });

    await upsertConversationBookingIntent(client, job, {
      event_type_uri: eventTypeUri,
      status: "booked",
      last_error: null,
    });
    await markJob(client, job.id, {
      status: "sent",
      sent_at: result.sentAt,
      attempt_count: (job.attempt_count ?? 0) + 1,
      last_error: null,
      payload: {
        ...(job.payload ?? {}),
        calendlyEventTypeUri: eventTypeUri,
        calendlyEventUri: booking.eventUri,
        calendlyInviteeUri: booking.uri,
        calendlyStartTime: requestedStart.toISOString(),
        textContent,
      },
    });

    return { sent: true };
  } catch (error) {
    if (isCalendlyPermissionError(error)) {
      await upsertConversationBookingIntent(client, job, {
        event_type_uri: eventTypeUri,
        status: "fallback_link",
        last_error: error instanceof Error ? error.message : "Calendly sin permisos.",
      });
      return sendCalendlyScheduleJob(client, job, conversation, account);
    }

    if (isCalendlyValidationError(error)) {
      return sendCalendlyBookingPrompt(
        client,
        job,
        conversation,
        account,
        "No pude completar la reserva con esos datos. Confirmame email, dia, hora y zona horaria.",
        "failed",
        error instanceof Error ? error.message : "Calendly rechazo la reserva.",
      );
    }

    throw error;
  }
}

async function sendAutomationJob(
  client: QueryClient,
  job: AutomationJobRow,
  run: AutomationRunRow,
  conversation: ConversationRuntimeRow,
  account: AccountRuntimeRow,
  agent: AutomationAgentRuntimeRow,
) {
  const rawMessageType = job.payload?.messageType;
  const messageType = rawMessageType === "audio" ? "audio" : "text";
  let textContent = normalizeOptionalString(
    typeof job.payload?.textContent === "string" ? job.payload.textContent : null,
  );
  const mediaUrl = normalizeOptionalString(
    typeof job.payload?.mediaUrl === "string" ? job.payload.mediaUrl : null,
  );

  if (rawMessageType === "smart_text") {
    const generationPrompt = normalizeOptionalString(
      typeof job.payload?.generationPrompt === "string" ? job.payload.generationPrompt : null,
    );

    if (!generationPrompt) {
      throw new Error("El texto inteligente no tiene prompt.");
    }

    const conversationMessages = await loadRecentConversationMessages(client, conversation.id);
    const inboundText =
      typeof job.payload?.inboundText === "string" ? job.payload.inboundText : null;

    textContent = await generateAgentSmartText(
      agent,
      run.owner_id,
      generationPrompt,
      inboundText,
      conversationMessages,
    );
  }

  const result = await sendAutomationOutboundMessage(client, conversation, account, {
    messageType,
    textContent,
    mediaUrl,
  });

  await markJob(client, job.id, {
    status: "sent",
    sent_at: result.sentAt,
    attempt_count: (job.attempt_count ?? 0) + 1,
    last_error: null,
    ...(rawMessageType === "smart_text"
      ? {
          payload: {
            ...(job.payload ?? {}),
            messageType: "text",
            generatedText: textContent,
          },
        }
      : {}),
  });

  if (job.job_type === "stage_message") {
    await maybeCompleteStage(client, run, job, result.sentAt);
  }

  return { sent: true };
}

async function sendAutomationAiReplyJob(
  client: QueryClient,
  job: AutomationJobRow,
  run: AutomationRunRow,
  conversation: ConversationRuntimeRow,
  account: AccountRuntimeRow,
  agent: AutomationAgentRuntimeRow,
) {
  const conversationMessages = await loadRecentConversationMessages(client, conversation.id);
  const inboundText =
    typeof job.payload?.inboundText === "string" ? job.payload.inboundText : null;
  const textContent = await generateAgentAiReply(
    agent,
    run.owner_id,
    inboundText,
    conversationMessages,
  );

  if (!textContent) {
    throw new Error("La IA no devolvio una respuesta para enviar.");
  }

  const result = await sendAutomationOutboundMessage(client, conversation, account, {
    messageType: "text",
    textContent,
    mediaUrl: null,
  });

  await markJob(client, job.id, {
    status: "sent",
    sent_at: result.sentAt,
    attempt_count: (job.attempt_count ?? 0) + 1,
    last_error: null,
  });

  await markRunCompleted(client, run.id);

  return { sent: true };
}

function shouldSkipFollowup(run: AutomationRunRow, job: AutomationJobRow) {
  const lastInboundMs = toMillis(run.last_inbound_at);
  const followupCreatedMs = toMillis(job.created_at) ?? toMillis(job.scheduled_for);

  if (lastInboundMs === null || followupCreatedMs === null) {
    return false;
  }

  return lastInboundMs > followupCreatedMs;
}

function isOutsideAutomationWindow(run: AutomationRunRow) {
  const lastInboundMs = toMillis(run.last_inbound_at);

  if (lastInboundMs === null) {
    return true;
  }

  return Date.now() - lastInboundMs > STANDARD_MESSAGING_WINDOW_MS;
}

async function cancelPendingJob(
  client: QueryClient,
  jobId: string,
  reason: string,
) {
  const result = await client
    .from("automation_jobs")
    .update({
      status: "cancelled",
      last_error: reason,
    } as never)
    .eq("id", jobId)
    .eq("status", "pending");

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function cleanupObsoleteFollowups(
  client: QueryClient,
  options: {
    limit: number;
    ownerId?: string;
  },
) {
  let jobsQuery = client
    .from("automation_jobs")
    .select("*")
    .eq("job_type", "followup")
    .eq("status", "pending");

  if (options.ownerId) {
    jobsQuery = jobsQuery.eq("owner_id", options.ownerId);
  }

  const jobsResult = await jobsQuery
    .order("created_at", { ascending: true })
    .limit(options.limit);
  const jobs = castRows<AutomationJobRow>(jobsResult.data);

  if (jobsResult.error) {
    throw new Error(jobsResult.error.message);
  }

  let cleaned = 0;
  const runsById = new Map<string, AutomationRunRow | null>();

  for (const job of jobs) {
    let run = runsById.get(job.run_id);

    if (!runsById.has(job.run_id)) {
      run = await loadRun(client, job.run_id);
      runsById.set(job.run_id, run);
    }

    if (!run || !shouldSkipFollowup(run, job)) {
      continue;
    }

    await cancelPendingJob(client, job.id, "El cliente respondio antes del followup.");
    cleaned += 1;
  }

  return { cleaned };
}

async function handleJob(
  client: QueryClient,
  job: AutomationJobRow,
  options?: {
    retryDelayMs?: number;
  },
): Promise<AutomationJobResult> {
  const [agent, run, conversation, account] = await Promise.all([
    loadAgent(client, job.agent_id),
    loadRun(client, job.run_id),
    loadConversation(client, job.conversation_id),
    loadAccount(client, job.account_id),
  ]);

  if (!agent || !run || !conversation || !account) {
    await markJob(client, job.id, {
      status: "skipped",
      last_error: "Dependencias faltantes para ejecutar el job.",
    });
    return "skipped_missing_dependencies" as const;
  }

  if (!agent.is_active) {
    await markJob(client, job.id, {
      status: "cancelled",
      last_error: "El agente ya no esta activo.",
    });
    return "cancelled_inactive_agent" as const;
  }

  if (job.job_type === "ai_reply" && !agent.ai_enabled) {
    await markJob(client, job.id, {
      status: "skipped",
      last_error: "La IA ya no esta activa para este agente.",
    });
    return "skipped_ai_disabled" as const;
  }

  if (
    (job.job_type === "followup" ||
      job.job_type === "calendly_schedule" ||
      job.job_type === "calendly_booking") &&
    shouldSkipFollowup(run, job)
  ) {
    await markJob(client, job.id, {
      status: "skipped",
      last_error: "El cliente respondio antes de que se envie esta respuesta.",
    });
    return "skipped_followup_answered" as const;
  }

  if (isOutsideAutomationWindow(run)) {
    await markJob(client, job.id, {
      status: "skipped",
      last_error:
        "Meta no permite automatizaciones fuera de las 24 horas desde el ultimo mensaje del cliente.",
    });
    return "skipped_outside_automation_window" as const;
  }

  try {
    if (job.job_type === "ai_reply") {
      await sendAutomationAiReplyJob(client, job, run, conversation, account, agent);
    } else if (job.job_type === "calendly_schedule") {
      const result = await sendCalendlyScheduleJob(client, job, conversation, account);

      if (!result.sent) {
        return "skipped_calendly_unconfigured" as const;
      }
    } else if (job.job_type === "calendly_booking") {
      const result = await sendCalendlyBookingJob(client, job, conversation, account);

      if (!result.sent) {
        return "skipped_calendly_unconfigured" as const;
      }
    } else {
      await sendAutomationJob(client, job, run, conversation, account, agent);
    }
    return "sent" as const;
  } catch (error) {
    const nextAttempt = (job.attempt_count ?? 0) + 1;
    const lastError = error instanceof Error ? error.message : String(error);

    if (nextAttempt < 3) {
      await markJob(client, job.id, {
        status: "pending",
        attempt_count: nextAttempt,
        last_error: lastError,
        scheduled_for: new Date(
          Date.now() + (options?.retryDelayMs ?? 5 * 60 * 1000),
        ).toISOString(),
      });
      return "retry_scheduled" as const;
    }

    await markJob(client, job.id, {
      status: "failed",
      attempt_count: nextAttempt,
      last_error: lastError,
    });
    return "failed" as const;
  }
}

async function loadNextPendingStageMessageJob(
  client: QueryClient,
  options: {
    runId: string;
    stageId: string;
  },
) {
  const result = await client
    .from("automation_jobs")
    .select("*")
    .eq("run_id", options.runId)
    .eq("stage_id", options.stageId)
    .eq("job_type", "stage_message")
    .eq("status", "pending")
    .order("scheduled_for", { ascending: true });

  if (result.error) {
    throw new Error(result.error.message);
  }

  const jobs = castRows<AutomationJobRow>(result.data);

  return (
    jobs.sort((left, right) => {
      const messageOrderDiff =
        getJobPayloadNumber(left, "messageOrder") - getJobPayloadNumber(right, "messageOrder");

      if (messageOrderDiff !== 0) {
        return messageOrderDiff;
      }

      const partOrderDiff = getStageMessagePartOrder(left) - getStageMessagePartOrder(right);

      if (partOrderDiff !== 0) {
        return partOrderDiff;
      }

      const scheduledDiff = compareNullableIso(left.scheduled_for, right.scheduled_for);

      if (scheduledDiff !== 0) {
        return scheduledDiff;
      }

      return compareNullableIso(left.created_at, right.created_at);
    })[0] ?? null
  );
}

async function cancelPendingStageMessageJobs(
  client: QueryClient,
  options: {
    runId: string;
    stageId: string;
    reason: string;
  },
) {
  const result = await client
    .from("automation_jobs")
    .update({
      status: "cancelled",
      last_error: options.reason,
    } as never)
    .eq("run_id", options.runId)
    .eq("stage_id", options.stageId)
    .eq("job_type", "stage_message")
    .eq("status", "pending");

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function canExecuteStageLive(
  client: QueryClient,
  options: {
    runId: string;
    stageId: string;
  },
) {
  const result = await client
    .from("automation_jobs")
    .select("scheduled_for")
    .eq("run_id", options.runId)
    .eq("stage_id", options.stageId)
    .eq("job_type", "stage_message")
    .eq("status", "pending")
    .order("scheduled_for", { ascending: false })
    .limit(1);

  if (result.error) {
    throw new Error(result.error.message);
  }

  const lastPendingJob = castRows<Pick<AutomationJobRow, "scheduled_for">>(result.data)[0];
  const lastScheduledMs = toMillis(lastPendingJob?.scheduled_for);

  if (!lastScheduledMs) {
    return false;
  }

  return lastScheduledMs - Date.now() <= LIVE_STAGE_EXECUTION_BUDGET_MS;
}

function shouldStopLiveStageExecution(result: AutomationJobResult) {
  return result !== "sent" && result !== "retry_scheduled";
}

export async function processScheduledStageMessages(
  client: QueryClient,
  options: {
    runId: string;
    stageId: string;
  },
) {
  const summary = createProcessingSummary();

  while (true) {
    const nextJob = await loadNextPendingStageMessageJob(client, options);

    if (!nextJob) {
      return summary;
    }

    const scheduledForMs = toMillis(nextJob.scheduled_for) ?? Date.now();
    await wait(scheduledForMs - Date.now());

    const claimedJob = await claimPendingJob(client, nextJob.id);

    if (!claimedJob) {
      continue;
    }

    summary.claimed += 1;
    const result = await handleJob(client, claimedJob, { retryDelayMs: 10_000 });
    addJobResultToSummary(summary, result);

    if (shouldStopLiveStageExecution(result)) {
      await cancelPendingStageMessageJobs(client, {
        runId: options.runId,
        stageId: options.stageId,
        reason: "La ejecucion viva de la etapa se detuvo antes de completar todos los mensajes.",
      });
      return summary;
    }
  }
}

export async function runAutomationForInboundMessage(
  client: QueryClient,
  options: {
    ownerId: string;
    accountId: string;
    conversationId: string;
    createdAt: string;
    isInbound: boolean;
    inboundMessageId?: string | null;
    inboundText?: string | null;
  },
) {
  const scheduleResult = await scheduleAutomationForInboundMessage(client, options);

  if (scheduleResult.reason !== "scheduled") {
    return {
      schedule: scheduleResult,
      stageExecution: null,
    };
  }

  const shouldExecuteLive = await canExecuteStageLive(client, {
    runId: scheduleResult.runId,
    stageId: scheduleResult.stageId,
  });

  if (!shouldExecuteLive) {
    const postScheduleDispatch =
      "calendlyBookingJobs" in scheduleResult &&
      scheduleResult.calendlyBookingJobs &&
      scheduleResult.calendlyBookingJobs > 0
        ? await processDueAutomationJobs(client, {
            limit: 5,
            ownerId: options.ownerId,
          })
        : null;

    return {
      schedule: scheduleResult,
      stageExecution: null,
      postScheduleDispatch,
    };
  }

  const stageExecution = await processScheduledStageMessages(client, {
    runId: scheduleResult.runId,
    stageId: scheduleResult.stageId,
  });
  const postStageDispatch = await processDueAutomationJobs(client, {
    limit: 5,
    ownerId: options.ownerId,
  });

  return {
    schedule: scheduleResult,
    stageExecution,
    postStageDispatch,
  };
}

export async function processDueAutomationJobs(
  client: QueryClient,
  options?: {
    limit?: number;
    ownerId?: string;
  },
) {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
  const nowIso = new Date().toISOString();
  const cleanupSummary = await cleanupObsoleteFollowups(client, {
    limit,
    ownerId: options?.ownerId,
  });
  let jobsQuery = client
    .from("automation_jobs")
    .select("*")
    .in("job_type", ["stage_message", "followup", "calendly_schedule", "calendly_booking"])
    .eq("status", "pending")
    .lte("scheduled_for", nowIso);

  if (options?.ownerId) {
    jobsQuery = jobsQuery.eq("owner_id", options.ownerId);
  }

  const jobsResult = await jobsQuery.order("scheduled_for", { ascending: true }).limit(limit);
  const jobs = castRows<AutomationJobRow>(jobsResult.data).sort(compareDueAutomationJobs);

  if (jobsResult.error) {
    throw new Error(jobsResult.error.message);
  }

  const summary = createProcessingSummary();
  summary.cleaned = cleanupSummary.cleaned;

  for (const pendingJob of jobs) {
    const claimedJob = await claimPendingJob(client, pendingJob.id);

    if (!claimedJob) {
      continue;
    }

    summary.claimed += 1;
    const result = await handleJob(client, claimedJob);
    addJobResultToSummary(summary, result);

    if (claimedJob.job_type === "stage_message" && shouldStopLiveStageExecution(result)) {
      await cancelPendingStageMessageJobs(client, {
        runId: claimedJob.run_id,
        stageId: claimedJob.stage_id,
        reason: "La ejecucion diferida de la etapa se detuvo antes de completar todos los mensajes.",
      });
    }
  }

  return summary;
}
