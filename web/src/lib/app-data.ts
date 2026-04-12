import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
export type {
  ConversationRecord,
  DashboardMetrics,
  InstagramAccountRecord,
  MessageRecord,
  ReminderRecord,
  UserProfile,
} from "@/lib/shared-data";
export {
  computeDashboardMetrics,
  enrichConversationsWithAccounts,
  formatCompactNumber,
  formatDateTime,
  formatRelativeTime,
  getConversationDisplayName,
  getConversationLabels,
  getConversationPreview,
  getDisplayName,
  getMessagePreview,
} from "@/lib/shared-data";
import type {
  ConversationRecord,
  InstagramAccountRecord,
  MessageRecord,
  ReminderRecord,
  UserProfile,
} from "@/lib/shared-data";

function castRow<T>(value: unknown) {
  return value as T;
}

function castRows<T>(value: unknown) {
  return value as T[];
}

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

  return castRow<UserProfile | null>(data);
}

export async function loadOwnedAccounts(
  supabase: SupabaseClient,
  userId: string,
): Promise<InstagramAccountRecord[]> {
  const { data, error } = await supabase
    .from("instagram_accounts")
    .select(
      [
        "id",
        "owner_id",
        "instagram_account_id",
        "instagram_app_user_id",
        "username",
        "name",
        "account_type",
        "profile_picture_url",
        "status",
        "token_expires_at",
        "token_lifecycle",
        "last_token_refresh_at",
        "connected_at",
        "last_oauth_at",
        "last_webhook_at",
        "created_at",
        "updated_at",
      ].join(","),
    )
    .eq("owner_id", userId)
    .order("connected_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return castRows<InstagramAccountRecord>(data);
}

export async function loadConversations(
  supabase: SupabaseClient,
  userId: string,
  limit = 200,
): Promise<ConversationRecord[]> {
  const { data, error } = await supabase
    .from("instagram_conversations")
    .select("*")
    .eq("owner_id", userId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return castRows<ConversationRecord>(data);
}

export async function loadConversationMessages(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 300,
): Promise<MessageRecord[]> {
  const { data, error } = await supabase
    .from("instagram_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return castRows<MessageRecord>(data);
}

export async function loadRecentMessagesForOwner(
  supabase: SupabaseClient,
  userId: string,
  limit = 1200,
): Promise<MessageRecord[]> {
  const { data, error } = await supabase
    .from("instagram_messages")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return castRows<MessageRecord>(data);
}

export async function loadReminders(
  supabase: SupabaseClient,
  userId: string,
  limit = 200,
): Promise<ReminderRecord[]> {
  const { data, error } = await supabase
    .from("instagram_reminders")
    .select("*")
    .eq("owner_id", userId)
    .order("remind_at", { ascending: true })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return castRows<ReminderRecord>(data);
}

export async function loadDueReminders(
  supabase: SupabaseClient,
  userId: string,
  limit = 6,
): Promise<ReminderRecord[]> {
  const { data, error } = await supabase
    .from("instagram_reminders")
    .select("*")
    .eq("owner_id", userId)
    .eq("status", "pending")
    .lte("remind_at", new Date().toISOString())
    .order("remind_at", { ascending: true })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return castRows<ReminderRecord>(data);
}
