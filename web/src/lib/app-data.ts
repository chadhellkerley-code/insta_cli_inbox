import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { syncInstagramUsernamesFromStoredRuntimeMetadata } from "@/lib/meta/instagram-username";
import { syncInstagramAccountProfile } from "@/lib/meta/profile-enrichment";
import { createAdminClient } from "@/lib/supabase/admin";
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
  getInstagramAccountDisplayName,
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

type InstagramContactRecord = {
  contact_igsid: string;
  contact_username: string | null;
  contact_name: string | null;
};

export async function selectOwnedAccounts(
  supabase: SupabaseClient,
  userId: string,
): Promise<InstagramAccountRecord[]> {
  const { data, error } = await supabase
    .from("instagram_accounts")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    console.error("[selectOwnedAccounts] failed", {
      userId,
      error: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
    });
    return [];
  }

  console.log("[selectOwnedAccounts] raw rows", {
    userId,
    count: data.length,
    rows: data,
  });

  return castRows<InstagramAccountRecord>(data);
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
  const accounts = await selectOwnedAccounts(supabase, userId);

  console.log("[loadOwnedAccounts] mapped accounts", {
    userId,
    count: accounts.length,
    accounts,
  });

  if (accounts.length === 0) {
    return accounts;
  }

  const admin = createAdminClient();
  const graphEnrichmentResults = await Promise.all(
    accounts.map(async (account) => {
      const needsGraphEnrichment =
        !account.username ||
        account.username.startsWith("ig_") ||
        !account.name ||
        !account.profile_picture_url;

      if (!needsGraphEnrichment) {
        return false;
      }

      try {
        const result = await syncInstagramAccountProfile({
          admin,
          account,
        });

        return result.updated;
      } catch (error) {
        console.warn("[loadOwnedAccounts] graph profile enrichment skipped", {
          userId,
          accountId: account.id,
          instagramAccountId: account.instagram_account_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }),
  );
  const graphEnrichmentCount = graphEnrichmentResults.filter(Boolean).length;

  const updatedAccounts = await syncInstagramUsernamesFromStoredRuntimeMetadata({
    admin,
    ownerId: userId,
    accounts,
  });

  if (updatedAccounts === 0 && graphEnrichmentCount === 0) {
    return accounts;
  }

  const refreshedAccounts = await selectOwnedAccounts(supabase, userId);

  console.log("[loadOwnedAccounts] mapped accounts", {
    userId,
    count: refreshedAccounts.length,
    accounts: refreshedAccounts,
  });

  return refreshedAccounts;
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

  const conversations = castRows<ConversationRecord>(data);

  if (conversations.length === 0) {
    return conversations;
  }

  const contactIds = Array.from(
    new Set(conversations.map((conversation) => conversation.contact_igsid).filter(Boolean)),
  );

  if (contactIds.length === 0) {
    return conversations;
  }

  const { data: contactsData, error: contactsError } = await supabase
    .from("instagram_contacts")
    .select("contact_igsid, contact_username, contact_name")
    .eq("owner_id", userId)
    .in("contact_igsid", contactIds);

  if (contactsError || !contactsData) {
    return conversations;
  }

  const contacts = castRows<InstagramContactRecord>(contactsData);
  const contactMap = new Map(contacts.map((contact) => [contact.contact_igsid, contact]));

  return conversations.map((conversation) => {
    const contact = contactMap.get(conversation.contact_igsid);

    if (!contact) {
      return conversation;
    }

    return {
      ...conversation,
      contact_username: contact.contact_username ?? conversation.contact_username,
      contact_name: contact.contact_name ?? conversation.contact_name,
    };
  });
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
