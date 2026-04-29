import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decryptApiKey,
  loadAiCredential,
  type AiCredentialProvider,
} from "@/lib/automation/ai-credentials";
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
  message_type: "text" | "audio";
  text_content: string | null;
  media_url: string | null;
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
  job_type: "stage_message" | "followup";
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
  | "skipped_followup_answered"
  | "skipped_missing_dependencies"
  | "skipped_outside_automation_window"
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

type GenerateAutomationReplyOptions = {
  ownerId: string;
  provider: AiCredentialProvider;
  model: string;
  apiKey: string;
  aiPrompt: string | null;
  personality: string | null;
  inboundText: string;
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

function buildAutomationAiSystemPrompt(options: Pick<
  GenerateAutomationReplyOptions,
  "aiPrompt" | "personality"
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
  ].filter(Boolean);

  return parts.join("\n");
}

function getAiEndpoint(provider: AiCredentialProvider) {
  if (provider === "groq") {
    return "https://api.groq.com/openai/v1/chat/completions";
  }

  return "https://api.openai.com/v1/chat/completions";
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
  const inboundText =
    normalizeOptionalString(options.inboundText) ?? "El cliente envio un mensaje sin texto.";
  const response = await fetch(getAiEndpoint(options.provider), {
    method: "POST",
    headers: {
      "authorization": `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: "system",
          content: buildAutomationAiSystemPrompt(options),
        },
        {
          role: "user",
          content: inboundText,
        },
      ],
      temperature: 0.7,
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const errorMessage = (payload as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(errorMessage ?? `Proveedor IA respondio con HTTP ${response.status}.`);
  }

  const content = readChatCompletionContent(payload);

  if (!content) {
    throw new Error("El proveedor IA no devolvio contenido.");
  }

  return content;
}

async function generateAgentAiReply(
  agent: AutomationAgentRuntimeRow,
  ownerId: string,
  inboundText: string | null | undefined,
) {
  if (!agent.ai_enabled) {
    return null;
  }

  const credential = await loadAiCredential(ownerId);

  if (!credential) {
    throw new Error("IA activada sin API key configurada.");
  }

  return generateAutomationReply({
    ownerId,
    provider: credential.provider,
    model: credential.model,
    apiKey: decryptApiKey(credential),
    aiPrompt: agent.ai_prompt,
    personality: agent.personality,
    inboundText: inboundText ?? "",
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
    case "skipped_missing_dependencies":
    case "skipped_outside_automation_window":
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

function buildStageMessageJobPayloads(
  stageMessage: AutomationStageMessageRuntimeRow,
  textOverride?: string | null,
) {
  const textContent =
    normalizeOptionalString(textOverride) ?? normalizeOptionalString(stageMessage.text_content);
  const mediaUrl = normalizeOptionalString(stageMessage.media_url);

  if (stageMessage.message_type !== "audio") {
    return [
      {
        messageType: "text" as const,
        textContent,
        mediaUrl: null,
      },
    ];
  }

  const parts: Array<{
    messageType: "text" | "audio";
    textContent: string | null;
    mediaUrl: string | null;
  }> = [];

  if (textContent) {
    parts.push({
      messageType: "text",
      textContent,
      mediaUrl: null,
    });
  }

  parts.push({
    messageType: "audio",
    textContent: null,
    mediaUrl,
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
    .select("id, agent_id, stage_order, name")
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
    .select("id, stage_id, message_order, message_type, text_content, media_url, delay_seconds")
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

async function cancelAnsweredPendingFollowups(
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
      last_error: "El cliente respondio antes del followup.",
    } as never)
    .eq("run_id", options.runId)
    .eq("job_type", "followup")
    .eq("status", "pending")
    .lt("created_at", options.inboundAt);

  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function scheduleAutomationForInboundMessage(
  client: QueryClient,
  options: {
    ownerId: string;
    accountId: string;
    conversationId: string;
    createdAt: string;
    isInbound: boolean;
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

  await cancelAnsweredPendingFollowups(client, {
    runId: run.id,
    inboundAt: options.createdAt,
  });

  if (await hasPendingStageMessages(client, run.id)) {
    return { scheduled: 0, reason: "stage_in_progress" as const };
  }

  const nextStageOrder = (run.last_completed_stage_order ?? 0) + 1;
  const nextStage = stages.find((stage) => stage.stage_order === nextStageOrder);

  if (!nextStage) {
    await markRunCompleted(client, run.id);
    return { scheduled: 0, reason: "flow_completed" as const };
  }

  const sentAudioJobs = await countSentAudioJobs(client, run.id);
  const stageMessages = messagesByStage.get(nextStage.id) ?? [];
  const aiReply = stageMessages.some((stageMessage) => stageMessage.message_type === "text")
    ? await generateAgentAiReply(agent, options.ownerId, options.inboundText)
    : null;
  let aiReplyUsed = false;
  const createdAtMs = toMillis(options.createdAt) ?? Date.now();
  const startAtMs = Math.max(
    Date.now(),
    createdAtMs +
      randomInteger(agent.min_reply_delay_seconds, agent.max_reply_delay_seconds) * 1000,
  );
  let scheduledAtMs = startAtMs;
  let insertedCount = 0;
  let insertedStageMessageCount = 0;
  let insertedFollowupCount = 0;
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

    const shouldUseAiReply =
      Boolean(aiReply) && !aiReplyUsed && stageMessage.message_type === "text";
    const jobPayloads = buildStageMessageJobPayloads(
      stageMessage,
      shouldUseAiReply ? aiReply : null,
    );
    let lastPartScheduledAtMs = scheduledAtMs;

    if (shouldUseAiReply) {
      aiReplyUsed = true;
    }

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

async function loadAgent(client: QueryClient, agentId: string) {
  const result = await client
    .from("automation_agents")
    .select("id, owner_id, is_active")
    .eq("id", agentId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return castRow<{ id: string; owner_id: string; is_active: boolean }>(result.data);
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

  await client
    .from("automation_runs")
    .update({
      last_completed_stage_order: Number.isFinite(stageOrder) ? stageOrder : run.last_completed_stage_order,
      active_stage_order: null,
      last_stage_completed_at: completedAt,
      status: "active",
    } as never)
    .eq("id", run.id);
}

async function sendAutomationJob(
  client: QueryClient,
  job: AutomationJobRow,
  run: AutomationRunRow,
  conversation: ConversationRuntimeRow,
  account: AccountRuntimeRow,
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
  const messageType = job.payload?.messageType === "audio" ? "audio" : "text";
  const textContent = normalizeOptionalString(
    typeof job.payload?.textContent === "string" ? job.payload.textContent : null,
  );
  const mediaUrl = normalizeOptionalString(
    typeof job.payload?.mediaUrl === "string" ? job.payload.mediaUrl : null,
  );

  if (messageType === "text" && !textContent) {
    throw new Error("El job no tiene contenido de texto.");
  }

  if (messageType === "audio" && !mediaUrl) {
    throw new Error("El job de audio no tiene media_url.");
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

  await markJob(client, job.id, {
    status: "sent",
    sent_at: nowIso,
    attempt_count: (job.attempt_count ?? 0) + 1,
    last_error: null,
  });

  if (job.job_type === "stage_message") {
    await maybeCompleteStage(client, run, job, nowIso);
  }

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

  if (job.job_type === "followup" && shouldSkipFollowup(run, job)) {
    await markJob(client, job.id, {
      status: "skipped",
      last_error: "El cliente respondio antes del followup.",
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
    await sendAutomationJob(client, job, run, conversation, account);
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

  const stageExecution = await processScheduledStageMessages(client, {
    runId: scheduleResult.runId,
    stageId: scheduleResult.stageId,
  });

  return {
    schedule: scheduleResult,
    stageExecution,
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
    .eq("job_type", "followup")
    .eq("status", "pending")
    .lte("scheduled_for", nowIso);

  if (options?.ownerId) {
    jobsQuery = jobsQuery.eq("owner_id", options.ownerId);
  }

  const jobsResult = await jobsQuery.order("scheduled_for", { ascending: true }).limit(limit);
  const jobs = castRows<AutomationJobRow>(jobsResult.data);

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
  }

  return summary;
}
