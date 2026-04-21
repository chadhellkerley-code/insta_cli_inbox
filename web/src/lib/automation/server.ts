import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AutomationAgent,
  AutomationAgentInput,
  AutomationAgentRecord,
  AutomationStageMessageRecord,
  AutomationStageRecord,
} from "@/lib/automation/types";
import { assertInstagramAudioUrlAccessible } from "@/lib/meta/audio-url";

type QueryClient = Pick<SupabaseClient, "from">;

function normalizeString(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function clampInteger(value: unknown, options: { min: number; max: number; fallback: number }) {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return options.fallback;
  }

  const integer = Math.round(numeric);
  return Math.min(options.max, Math.max(options.min, integer));
}

function normalizeOptionalString(value: unknown) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function ensureAgentName(value: unknown) {
  const normalized = normalizeString(value);
  return normalized || "Agente nuevo";
}

function ensureStageName(value: unknown, index: number) {
  const normalized = normalizeString(value);
  return normalized || `Etapa ${index + 1}`;
}

function ensureTextMessageContent(value: unknown) {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new Error("Cada mensaje de texto necesita contenido.");
  }

  return normalized;
}

function ensureAudioMessageUrl(value: unknown) {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new Error("Cada audio necesita un archivo o una URL publica.");
  }

  return normalized;
}

async function validateAutomationAudioMessages(input: AutomationAgentInput) {
  const validationCache = new Map<string, Promise<unknown>>();
  const validations: Promise<unknown>[] = [];

  for (let stageIndex = 0; stageIndex < input.stages.length; stageIndex += 1) {
    const stage = input.stages[stageIndex];

    for (let messageIndex = 0; messageIndex < stage.messages.length; messageIndex += 1) {
      const message = stage.messages[messageIndex];

      if (message.messageType !== "audio") {
        continue;
      }

      const mediaUrl = ensureAudioMessageUrl(message.mediaUrl);
      let validation = validationCache.get(mediaUrl);

      if (!validation) {
        validation = assertInstagramAudioUrlAccessible(mediaUrl);
        validationCache.set(mediaUrl, validation);
      }

      validations.push(
        validation.catch((error) => {
          const stageName = ensureStageName(stage.name, stageIndex);
          const messageLabel = `mensaje ${messageIndex + 1}`;
          const reason =
            error instanceof Error ? error.message : "No pudimos validar el audio.";

          throw new Error(`${stageName}: ${messageLabel}. ${reason}`);
        }),
      );
    }
  }

  await Promise.all(validations);
}

export function sanitizeAutomationAgentInput(input: AutomationAgentInput): AutomationAgentInput {
  const minReplyDelaySeconds = clampInteger(input.minReplyDelaySeconds, {
    min: 0,
    max: 3600,
    fallback: 30,
  });
  const maxReplyDelaySeconds = clampInteger(input.maxReplyDelaySeconds, {
    min: minReplyDelaySeconds,
    max: 7200,
    fallback: Math.max(minReplyDelaySeconds, 90),
  });
  const maxMediaPerChat = clampInteger(input.maxMediaPerChat, {
    min: 0,
    max: 50,
    fallback: 1,
  });
  const stages = Array.isArray(input.stages) ? input.stages : [];

  if (stages.length === 0) {
    throw new Error("El agente necesita al menos una etapa.");
  }

  return {
    id: normalizeString(input.id) || undefined,
    name: ensureAgentName(input.name),
    personality: normalizeString(input.personality),
    minReplyDelaySeconds,
    maxReplyDelaySeconds,
    maxMediaPerChat,
    isActive: Boolean(input.isActive),
    aiEnabled: Boolean(input.aiEnabled),
    aiPrompt: normalizeString(input.aiPrompt),
    stages: stages.map((stage, stageIndex) => {
      const messages = Array.isArray(stage.messages) ? stage.messages : [];

      if (messages.length === 0) {
        throw new Error(`La ${ensureStageName(stage.name, stageIndex)} necesita al menos un mensaje.`);
      }

      const followupEnabled = Boolean(stage.followupEnabled);
      const followupMessage = normalizeString(stage.followupMessage);
      const followupDelayMinutes = clampInteger(stage.followupDelayMinutes, {
        min: 0,
        max: 60 * 24 * 30,
        fallback: 120,
      });

      if (followupEnabled && !followupMessage) {
        throw new Error(`La ${ensureStageName(stage.name, stageIndex)} tiene followup activo pero sin mensaje.`);
      }

      return {
        id: normalizeString(stage.id) || undefined,
        name: ensureStageName(stage.name, stageIndex),
        followupEnabled,
        followupDelayMinutes,
        followupMessage,
        messages: messages.map((message) => {
          const messageType = message.messageType === "audio" ? "audio" : "text";

          return {
            id: normalizeString(message.id) || undefined,
            messageType,
            textContent:
              messageType === "text"
                ? ensureTextMessageContent(message.textContent)
                : normalizeString(message.textContent),
            mediaUrl:
              messageType === "audio" ? ensureAudioMessageUrl(message.mediaUrl) : "",
            delaySeconds: clampInteger(message.delaySeconds, {
              min: 0,
              max: 60 * 60 * 24,
              fallback: 0,
            }),
          };
        }),
      };
    }),
  };
}

function castRows<T>(value: unknown) {
  return (value ?? []) as T[];
}

function mapAutomationAgents(
  agents: AutomationAgentRecord[],
  stages: AutomationStageRecord[],
  messages: AutomationStageMessageRecord[],
) {
  const messagesByStage = new Map<string, AutomationStageMessageRecord[]>();

  for (const message of messages) {
    const current = messagesByStage.get(message.stage_id) ?? [];
    current.push(message);
    messagesByStage.set(message.stage_id, current);
  }

  const stagesByAgent = new Map<string, AutomationStageRecord[]>();

  for (const stage of stages) {
    const current = stagesByAgent.get(stage.agent_id) ?? [];
    current.push(stage);
    stagesByAgent.set(stage.agent_id, current);
  }

  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    personality: agent.personality ?? "",
    minReplyDelaySeconds: agent.min_reply_delay_seconds,
    maxReplyDelaySeconds: agent.max_reply_delay_seconds,
    maxMediaPerChat: agent.max_media_per_chat,
    isActive: agent.is_active,
    aiEnabled: agent.ai_enabled,
    aiPrompt: agent.ai_prompt ?? "",
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
    stages: (stagesByAgent.get(agent.id) ?? [])
      .sort((left, right) => left.stage_order - right.stage_order)
      .map((stage) => ({
        id: stage.id,
        name: stage.name,
        order: stage.stage_order,
        followupEnabled: stage.followup_enabled,
        followupDelayMinutes: stage.followup_delay_minutes,
        followupMessage: stage.followup_message ?? "",
        messages: (messagesByStage.get(stage.id) ?? [])
          .sort((left, right) => left.message_order - right.message_order)
          .map((message) => ({
            id: message.id,
            order: message.message_order,
            messageType: message.message_type,
            textContent: message.text_content ?? "",
            mediaUrl: message.media_url ?? "",
            delaySeconds: message.delay_seconds,
          })),
      })),
  })) satisfies AutomationAgent[];
}

export async function loadAutomationAgents(
  client: QueryClient,
  ownerId: string,
): Promise<AutomationAgent[]> {
  const agentsResult = await client
    .from("automation_agents")
    .select("*")
    .eq("owner_id", ownerId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: true });
  const agents = castRows<AutomationAgentRecord>(agentsResult.data);

  if (agentsResult.error || agents.length === 0) {
    return [];
  }

  const agentIds = agents.map((agent) => agent.id);
  const stagesResult = await client
    .from("automation_agent_stages")
    .select("*")
    .in("agent_id", agentIds)
    .order("stage_order", { ascending: true });
  const stages = castRows<AutomationStageRecord>(stagesResult.data);

  if (stagesResult.error || stages.length === 0) {
    return mapAutomationAgents(agents, [], []);
  }

  const stageIds = stages.map((stage) => stage.id);
  const messagesResult = await client
    .from("automation_stage_messages")
    .select("*")
    .in("stage_id", stageIds)
    .order("message_order", { ascending: true });
  const messages = castRows<AutomationStageMessageRecord>(messagesResult.data);

  if (messagesResult.error) {
    return mapAutomationAgents(agents, stages, []);
  }

  return mapAutomationAgents(agents, stages, messages);
}

async function cancelPendingJobsForAgent(client: QueryClient, agentId: string) {
  const jobsUpdate = await client
    .from("automation_jobs")
    .update({
      status: "cancelled",
      last_error: "Configuracion actualizada.",
    } as never)
    .eq("agent_id", agentId)
    .in("status", ["pending", "processing"]);

  if (jobsUpdate.error) {
    throw new Error(jobsUpdate.error.message);
  }

  const runsUpdate = await client
    .from("automation_runs")
    .update({
      active_stage_order: null,
      status: "active",
    } as never)
    .eq("agent_id", agentId);

  if (runsUpdate.error) {
    throw new Error(runsUpdate.error.message);
  }
}

export async function saveAutomationAgent(
  client: QueryClient,
  ownerId: string,
  input: AutomationAgentInput,
) {
  const payload = sanitizeAutomationAgentInput(input);
  await validateAutomationAudioMessages(payload);
  const nowIso = new Date().toISOString();
  const isUpdate = Boolean(payload.id);
  let agentId = payload.id;
  let deactivatedAgentIds: string[] = [];

  if (payload.isActive) {
    let deactivateOthers = client
      .from("automation_agents")
      .update({
        is_active: false,
        updated_at: nowIso,
      } as never)
      .eq("owner_id", ownerId)
      .eq("is_active", true);

    if (agentId) {
      deactivateOthers = deactivateOthers.neq("id", agentId);
    }

    const deactivateResult = await deactivateOthers.select("id");

    if (deactivateResult.error) {
      throw new Error(deactivateResult.error.message);
    } else {
      deactivatedAgentIds = castRows<{ id: string }>(deactivateResult.data).map(
        (agent) => agent.id,
      );
    }
  }

  if (isUpdate && agentId) {
    const existingResult = await client
      .from("automation_agents")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("id", agentId)
      .maybeSingle();

    if (existingResult.error || !existingResult.data) {
      throw new Error("El agente no existe o no te pertenece.");
    }

    const updateResult = await client
      .from("automation_agents")
      .update({
        name: payload.name,
        personality: normalizeOptionalString(payload.personality),
        min_reply_delay_seconds: payload.minReplyDelaySeconds,
        max_reply_delay_seconds: payload.maxReplyDelaySeconds,
        max_media_per_chat: payload.maxMediaPerChat,
        is_active: payload.isActive,
        ai_enabled: payload.aiEnabled,
        ai_prompt: normalizeOptionalString(payload.aiPrompt),
        updated_at: nowIso,
      } as never)
      .eq("id", agentId)
      .eq("owner_id", ownerId)
      .select("id")
      .maybeSingle();

    if (updateResult.error || !updateResult.data) {
      throw new Error(updateResult.error?.message ?? "No pudimos actualizar el agente.");
    }

    await cancelPendingJobsForAgent(client, agentId);

    const deleteStagesResult = await client
      .from("automation_agent_stages")
      .delete()
      .eq("agent_id", agentId)
      .eq("owner_id", ownerId);

    if (deleteStagesResult.error) {
      throw new Error(deleteStagesResult.error.message);
    }
  } else {
    const insertResult = await client
      .from("automation_agents")
      .insert({
        owner_id: ownerId,
        name: payload.name,
        personality: normalizeOptionalString(payload.personality),
        min_reply_delay_seconds: payload.minReplyDelaySeconds,
        max_reply_delay_seconds: payload.maxReplyDelaySeconds,
        max_media_per_chat: payload.maxMediaPerChat,
        is_active: payload.isActive,
        ai_enabled: payload.aiEnabled,
        ai_prompt: normalizeOptionalString(payload.aiPrompt),
      } as never)
      .select("id")
      .maybeSingle();

    if (insertResult.error || !insertResult.data) {
      throw new Error(insertResult.error?.message ?? "No pudimos crear el agente.");
    }

    agentId = (insertResult.data as { id: string }).id;
  }

  if (!agentId) {
    throw new Error("No pudimos resolver el agente.");
  }

  for (const deactivatedAgentId of deactivatedAgentIds) {
    await cancelPendingJobsForAgent(client, deactivatedAgentId);
  }

  for (let stageIndex = 0; stageIndex < payload.stages.length; stageIndex += 1) {
    const stage = payload.stages[stageIndex];
    const stageInsert = await client
      .from("automation_agent_stages")
      .insert({
        owner_id: ownerId,
        agent_id: agentId,
        stage_order: stageIndex + 1,
        name: stage.name,
        followup_enabled: stage.followupEnabled,
        followup_delay_minutes: stage.followupDelayMinutes,
        followup_message: normalizeOptionalString(stage.followupMessage),
      } as never)
      .select("id")
      .maybeSingle();

    if (stageInsert.error || !stageInsert.data) {
      throw new Error(stageInsert.error?.message ?? "No pudimos guardar una etapa.");
    }

    const stageId = (stageInsert.data as { id: string }).id;

    for (let messageIndex = 0; messageIndex < stage.messages.length; messageIndex += 1) {
      const message = stage.messages[messageIndex];
      const messageInsert = await client.from("automation_stage_messages").insert({
        owner_id: ownerId,
        stage_id: stageId,
        message_order: messageIndex + 1,
        message_type: message.messageType,
        text_content: normalizeOptionalString(message.textContent),
        media_url: normalizeOptionalString(message.mediaUrl),
        delay_seconds: message.delaySeconds,
      } as never);

      if (messageInsert.error) {
        throw new Error(messageInsert.error.message);
      }
    }
  }

  const agents = await loadAutomationAgents(client, ownerId);
  return agents.find((agent) => agent.id === agentId) ?? null;
}

export async function deleteAutomationAgent(
  client: QueryClient,
  ownerId: string,
  agentId: string,
) {
  const deleteResult = await client
    .from("automation_agents")
    .delete()
    .eq("id", agentId)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();

  if (deleteResult.error || !deleteResult.data) {
    throw new Error(deleteResult.error?.message ?? "No pudimos eliminar el agente.");
  }
}
