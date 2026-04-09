import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
export type {
  AccountRecord,
  AgentPresence,
  ChatRecord,
  DashboardMetrics,
  OwnerAgentRecord,
  ThreadSummary,
  UserProfile,
} from "@/lib/shared-data";
export {
  buildThreadKey,
  buildThreadSummaries,
  computeDashboardMetrics,
  extractTags,
  formatCompactNumber,
  formatDateTime,
  formatRelativeTime,
  getDisplayName,
} from "@/lib/shared-data";
import type {
  AccountRecord,
  AgentPresence,
  ChatRecord,
  OwnerAgentRecord,
  UserProfile,
} from "@/lib/shared-data";

export async function requireUserContext() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await loadUserProfile(supabase, user.id);

  if (profile?.expires_at && Date.now() > new Date(profile.expires_at).getTime()) {
    redirect("/login?error=Tu acceso expir%C3%B3. Contact%C3%A1 al administrador.");
  }

  return { supabase, user, profile };
}

export async function loadUserProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data;
}

export async function loadOwnedAccounts(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountRecord[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as AccountRecord[];
}

export async function loadOwnerAgents(
  supabase: SupabaseClient,
  userId: string,
): Promise<OwnerAgentRecord[]> {
  const { data, error } = await supabase
    .from("owner_agents")
    .select("owner_id, agent_id, label, created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data as OwnerAgentRecord[]) ?? [];
}

export async function loadAgentPresenceForAgents(
  supabase: SupabaseClient,
  agentIds: string[],
): Promise<AgentPresence[]> {
  if (agentIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("agent_presence")
    .select("agent_id, machine_name, status, last_seen_at")
    .in("agent_id", agentIds)
    .order("last_seen_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data as AgentPresence[]) ?? [];
}

export async function loadLatestAgentPresence(
  supabase: SupabaseClient,
  userId: string,
): Promise<AgentPresence | null> {
  const ownerAgents = await loadOwnerAgents(supabase, userId);
  const presences = await loadAgentPresenceForAgents(
    supabase,
    ownerAgents.map((agent) => agent.agent_id),
  );

  return presences[0] ?? null;
}

export async function loadStages(
  supabase: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from("stages")
    .select("*")
    .eq("user_id", userId)
    .limit(8);

  if (error || !data) {
    return [];
  }

  return data as Record<string, unknown>[];
}

export async function loadRecentChatsForAccounts(
  supabase: SupabaseClient,
  accountIds: number[],
  limit = 1200,
): Promise<ChatRecord[]> {
  if (accountIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("chats")
    .select("*")
    .in("account_id", accountIds)
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data as ChatRecord[];
}

export async function loadThreadMessages(
  supabase: SupabaseClient,
  accountId: number,
  threadId: string,
  limit = 300,
): Promise<ChatRecord[]> {
  const { data, error } = await supabase
    .from("chats")
    .select("*")
    .eq("account_id", accountId)
    .eq("thread_id", threadId)
    .order("timestamp", { ascending: true })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data as ChatRecord[];
}
