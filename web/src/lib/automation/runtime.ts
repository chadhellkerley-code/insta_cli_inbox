import type { SupabaseClient } from "@supabase/supabase-js";

import { sendInstagramMessage } from "@/lib/meta/client";
import {
  INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY,
  INSTAGRAM_MESSAGING_STATUS_READY,
} from "@/lib/meta/account-status";
import { ensureInstagramAccessToken } from "@/lib/meta/token-lifecycle";

type QueryClient = Pick<SupabaseClient, "from">;

type AutomationAgentRuntimeRow = {
  id: string;
  owner_id: string;
  name: string;
  min_reply_delay_seconds: number;
  max_reply_delay_seconds: number;
  max_media_per_chat: number;
  is_active: boolean;
};

type AutomationStageRuntimeRow = {
  id: string;
  agent_id: string;
  stage_order: number;
  name: string;
  followup_enabled: boolean;
  followup_delay_minutes: number;
  followup_message: string | null;
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

  const delta = max - min + 1;
  return min + Math.floor(Math.random() * delta);
}

async function loadActiveAgent(client: QueryClient, ownerId: string) {
  const result = await client
    .from("automation_agents")
    .select("id, owner_id, name, min_reply_delay_seconds, max_reply_delay_seconds, max_media_per_chat, is_active")
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
    .select("id, agent_id, stage_order, name, followup_enabled, followup_delay_minutes, followup_message")
    .eq("agent_id", agentId)
    .order("stage_order", { ascending: true });
  const stages = castRows<AutomationStageRuntimeRow>(stagesResult.data);

  if (stagesResult.error || stages.length === 0) {
    return {
      stages: [],
      messagesByStage: new Map<string, AutomationStageMessageRuntimeRow[]>(),
    };
  }

  const stageIds = stages.map((stage) => stage.id);
  const messagesResult = await client
    .from("automation_stage_messages")
    .select("id, stage_id, message_order, message_type, text_content, media_url, delay_seconds")
    .in("stage_id", stageIds)
    .order("message_order", { ascending: true });
  const messages = castRows<AutomationStageMessageRuntimeRow>(messagesResult.data);

  if (messagesResult.error) {
    throw new Error(messagesResult.error.message);
  }

  const messagesByStage = new Map<string, AutomationStageMessageRuntimeRow[]>();

  for (const message of messages) {
    const current = messagesByStage.get(message.stage_id) ?? [];
    current.push(message);
    messagesByStage.set(message.stage_id, current);
  }

  return {
    stages,
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

export async function scheduleAutomationForInboundMessage(
  client: QueryClient,
  options: {
    ownerId: string;
    accountId: string;
    conversationId: string;
    createdAt: string;
    isInbound: boolean;
  },
) {
  if (!options.isInbound) {
    return { scheduled: 0, reason: "not_inbound" as const };
  }

  const agent = await loadActiveAgent(client, options.ownerId);

  if (!agent) {
    return { scheduled: 0, reason: "no_active_agent" as const };
  }

  const { stages, messagesByStage } = await loadStagesForAgent(client, agent.id);

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
  const startAtMs =
    new Date(options.createdAt).getTime() +
    randomInteger(agent.min_reply_delay_seconds, agent.max_reply_delay_seconds) * 1000;
  let scheduledAtMs = startAtMs;
  let insertedCount = 0;
  let usedAudio = sentAudioJobs;
  let lastScheduledIso = new Date(startAtMs).toISOString();

  for (const stageMessage of stageMessages) {
    if (insertedCount > 0) {
      scheduledAtMs += stageMessage.delay_seconds * 1000;
    }

    if (stageMessage.message_type === "audio" && usedAudio >= agent.max_media_per_chat) {
      continue;
    }

    lastScheduledIso = new Date(scheduledAtMs).toISOString();

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
        messageType: stageMessage.message_type,
        textContent: stageMessage.text_content,
        mediaUrl: stageMessage.media_url,
      },
    } as never);

    if (insertResult.error) {
      throw new Error(insertResult.error.message);
    }

    insertedCount += 1;

    if (stageMessage.message_type === "audio") {
      usedAudio += 1;
    }
  }

  if (insertedCount === 0) {
    return { scheduled: 0, reason: "no_deliverable_messages" as const };
  }

  if (nextStage.followup_enabled && normalizeOptionalString(nextStage.followup_message)) {
    const followupScheduledFor = new Date(
      scheduledAtMs + nextStage.followup_delay_minutes * 60 * 1000,
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
        messageType: "text",
        textContent: nextStage.followup_message,
      },
    } as never);

    if (insertFollowup.error) {
      throw new Error(insertFollowup.error.message);
    }

    insertedCount += 1;
  }

  await client
    .from("automation_runs")
    .update({
      active_stage_order: nextStage.stage_order,
      last_stage_scheduled_at: lastScheduledIso,
      status: "active",
    } as never)
    .eq("id", run.id);

  return { scheduled: insertedCount, reason: "scheduled" as const };
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
    .select("id, owner_id, instagram_account_id, instagram_app_user_id, access_token, token_expires_at")
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

  const response = await sendInstagramMessage({
    accessToken: managedToken.accessToken,
    instagramAccountId: account.instagram_account_id,
    recipientId: conversation.contact_igsid,
    text: textContent ?? undefined,
    messageType: messageType === "audio" ? "audio" : undefined,
    mediaUrl: mediaUrl ?? undefined,
  });
  const nowIso = new Date().toISOString();
  const preview = textContent ?? (messageType === "audio" ? "Mensaje de audio" : "Mensaje");

  const messageInsert = await client.from("instagram_messages").insert({
    owner_id: conversation.owner_id,
    account_id: conversation.account_id,
    conversation_id: conversation.id,
    meta_message_id: response.message_id ?? crypto.randomUUID(),
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

function shouldSkipFollowup(run: AutomationRunRow) {
  const lastInboundMs = toMillis(run.last_inbound_at);
  const lastStageCompletedMs = toMillis(run.last_stage_completed_at);

  if (lastInboundMs === null || lastStageCompletedMs === null) {
    return false;
  }

  return lastInboundMs > lastStageCompletedMs;
}

async function handleJob(client: QueryClient, job: AutomationJobRow) {
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

  if (job.job_type === "followup" && shouldSkipFollowup(run)) {
    await markJob(client, job.id, {
      status: "skipped",
      last_error: "El cliente respondio antes del followup.",
    });
    return "skipped_followup_answered" as const;
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
        scheduled_for: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
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

export async function processDueAutomationJobs(
  client: QueryClient,
  options?: {
    limit?: number;
    ownerId?: string;
  },
) {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
  const nowIso = new Date().toISOString();
  let jobsQuery = client
    .from("automation_jobs")
    .select("*")
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

  const summary = {
    claimed: 0,
    sent: 0,
    skipped: 0,
    cancelled: 0,
    retried: 0,
    failed: 0,
  };

  for (const pendingJob of jobs) {
    const claimedJob = await claimPendingJob(client, pendingJob.id);

    if (!claimedJob) {
      continue;
    }

    summary.claimed += 1;
    const result = await handleJob(client, claimedJob);

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
        summary.skipped += 1;
        break;
      default:
        summary.failed += 1;
        break;
    }
  }

  return summary;
}
