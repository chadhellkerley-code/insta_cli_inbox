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
  UserProfile,
} from "@/lib/shared-data";

const INSTAGRAM_ACCOUNT_REQUIRED_COLUMNS = [
  "id",
  "owner_id",
  "instagram_user_id",
  "instagram_account_id",
  "instagram_app_user_id",
  "username",
  "name",
  "account_type",
  "profile_picture_url",
  "status",
  "token_obtained_at",
  "expires_in",
  "expires_at",
  "token_expires_at",
  "token_lifecycle",
  "last_token_refresh_at",
  "connected_at",
  "last_oauth_at",
  "last_webhook_at",
  "created_at",
  "updated_at",
] as const;

const INSTAGRAM_ACCOUNT_OPTIONAL_COLUMNS = [
  "page_id",
  "webhook_subscribed_at",
  "webhook_status",
  "messaging_status",
  "last_webhook_check_at",
  "webhook_subscription_error",
] as const;

const INSTAGRAM_ACCOUNT_SELECT = [
  ...INSTAGRAM_ACCOUNT_REQUIRED_COLUMNS,
  ...INSTAGRAM_ACCOUNT_OPTIONAL_COLUMNS,
].join(", ");

const INSTAGRAM_ACCOUNT_SELECT_FALLBACK = INSTAGRAM_ACCOUNT_REQUIRED_COLUMNS.join(", ");

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
  profile_picture_url: string | null;
};

type InstagramAccountProfileSyncRecord = {
  id: string;
  instagram_account_id: string;
  username: string;
  name: string | null;
  profile_picture_url: string | null;
  access_token: string;
  token_expires_at: string | null;
};

type QueryErrorShape = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

function isMissingInstagramContactsTableError(
  error: QueryErrorShape | null | undefined,
) {
  const haystack = [error?.message, error?.details, error?.hint]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  if (!haystack) {
    return false;
  }

  return (
    haystack.includes("instagram_contacts") &&
    (haystack.includes("schema cache") ||
      haystack.includes("does not exist") ||
      haystack.includes("could not find the table"))
  );
}

function getSupabaseProjectHost() {
  try {
    return (
      new URL(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
      ).host || "unknown"
    );
  } catch {
    return "unknown";
  }
}

function getMissingInstagramAccountOptionalColumns(error: QueryErrorShape | null | undefined) {
  const haystack = [error?.message, error?.details, error?.hint]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");

  if (!haystack) {
    return [];
  }

  return INSTAGRAM_ACCOUNT_OPTIONAL_COLUMNS.filter((column) => haystack.includes(column));
}

function withInstagramAccountOptionalDefaults(account: Partial<InstagramAccountRecord>) {
  return {
    page_id: null,
    webhook_subscribed_at: null,
    webhook_status: null,
    messaging_status: null,
    last_webhook_check_at: null,
    webhook_subscription_error: null,
    ...account,
  } as InstagramAccountRecord;
}

async function selectInstagramAccountsForOwner(
  client: Pick<SupabaseClient, "from">,
  userId: string,
  options: {
    queryLabel: string;
  },
) {
  const primaryResult = await client
    .from("instagram_accounts")
    .select(INSTAGRAM_ACCOUNT_SELECT)
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  const primaryError = primaryResult.error as QueryErrorShape | null;
  const missingOptionalColumns = getMissingInstagramAccountOptionalColumns(primaryError);

  if (primaryError && missingOptionalColumns.length > 0) {
    console.warn(`[${options.queryLabel}] retrying instagram_accounts query without optional columns`, {
      userId,
      projectHost: getSupabaseProjectHost(),
      missingOptionalColumns,
      error: primaryError.message,
      details: primaryError.details,
      hint: primaryError.hint,
      code: primaryError.code,
    });

    const fallbackResult = await client
      .from("instagram_accounts")
      .select(INSTAGRAM_ACCOUNT_SELECT_FALLBACK)
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });

    return {
      data: castRows<InstagramAccountRecord>(
        (fallbackResult.data ?? []).map((account) =>
          withInstagramAccountOptionalDefaults(account as Partial<InstagramAccountRecord>),
        ),
      ),
      error: fallbackResult.error,
      missingOptionalColumns,
    };
  }

  return {
    data: castRows<InstagramAccountRecord>(
      (primaryResult.data ?? []).map((account) =>
        withInstagramAccountOptionalDefaults(account as Partial<InstagramAccountRecord>),
      ),
    ),
    error: primaryResult.error,
    missingOptionalColumns,
  };
}

export async function selectOwnedAccounts(
  supabase: SupabaseClient,
  userId: string,
): Promise<InstagramAccountRecord[]> {
  const { data, error, missingOptionalColumns } = await selectInstagramAccountsForOwner(
    supabase,
    userId,
    {
      queryLabel: "selectOwnedAccounts",
    },
  );

  if (error || !data) {
    console.error("[selectOwnedAccounts] failed", {
      userId,
      projectHost: getSupabaseProjectHost(),
      missingOptionalColumns,
      error: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
    });
    return [];
  }

  const rows = castRows<InstagramAccountRecord>(data);

  console.log("[selectOwnedAccounts] raw rows", {
    userId,
    projectHost: getSupabaseProjectHost(),
    count: rows.length,
    rows,
  });

  return rows;
}

async function selectOwnedAccountsWithAdmin(
  userId: string,
): Promise<InstagramAccountRecord[]> {
  const admin = createAdminClient();
  const { data, error, missingOptionalColumns } = await selectInstagramAccountsForOwner(
    admin,
    userId,
    {
      queryLabel: "selectOwnedAccountsWithAdmin",
    },
  );

  if (error || !data) {
    console.error("[selectOwnedAccountsWithAdmin] failed", {
      userId,
      projectHost: getSupabaseProjectHost(),
      missingOptionalColumns,
      error: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
    });
    return [];
  }

  const rows = castRows<InstagramAccountRecord>(data);

  console.log("[selectOwnedAccountsWithAdmin] raw rows", {
    userId,
    projectHost: getSupabaseProjectHost(),
    count: rows.length,
    ownerIds: rows.map((account) => account.owner_id),
    rows,
  });

  return rows;
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
    .select("id, email, full_name, avatar_url, role, expires_at, last_login_at")
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
  let accounts = await selectOwnedAccounts(supabase, userId);

  if (accounts.length === 0) {
    const adminAccounts = await selectOwnedAccountsWithAdmin(userId);

    if (adminAccounts.length > 0) {
      console.warn("[loadOwnedAccounts] user-scoped query returned 0 but admin query found rows", {
        userId,
        projectHost: getSupabaseProjectHost(),
        adminCount: adminAccounts.length,
        ownerIds: adminAccounts.map((account) => account.owner_id),
        accountIds: adminAccounts.map((account) => account.instagram_account_id),
      });
      accounts = adminAccounts;
    }
  }

  console.log("[loadOwnedAccounts] mapped accounts", {
    userId,
    projectHost: getSupabaseProjectHost(),
    count: accounts.length,
    accounts,
  });

  if (accounts.length === 0) {
    return accounts;
  }

  const admin = createAdminClient();
  const { data: syncAccountsData, error: syncAccountsError } = await admin
    .from("instagram_accounts")
    .select(
      "id, instagram_account_id, username, name, profile_picture_url, access_token, token_expires_at",
    )
    .eq("owner_id", userId);

  if (syncAccountsError) {
    console.warn("[loadOwnedAccounts] account profile sync lookup failed", {
      userId,
      error: syncAccountsError.message,
    });
  }

  const syncAccounts = castRows<InstagramAccountProfileSyncRecord>(syncAccountsData ?? []);
  const graphEnrichmentResults = await Promise.all(
    syncAccounts.map(async (account) => {
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

  if (refreshedAccounts.length === 0) {
    const adminAccounts = await selectOwnedAccountsWithAdmin(userId);

    if (adminAccounts.length > 0) {
      console.warn("[loadOwnedAccounts] refreshed user-scoped query returned 0 but admin query found rows", {
        userId,
        projectHost: getSupabaseProjectHost(),
        adminCount: adminAccounts.length,
        ownerIds: adminAccounts.map((account) => account.owner_id),
        accountIds: adminAccounts.map((account) => account.instagram_account_id),
      });
      return adminAccounts;
    }
  }

  console.log("[loadOwnedAccounts] mapped accounts", {
    userId,
    projectHost: getSupabaseProjectHost(),
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
    .select("contact_igsid, contact_username, contact_name, profile_picture_url")
    .eq("owner_id", userId)
    .in("contact_igsid", contactIds);

  if (contactsError || !contactsData) {
    if (isMissingInstagramContactsTableError(contactsError as QueryErrorShape | null)) {
      console.warn("[loadConversations] instagram_contacts table missing; returning base conversation rows", {
        userId,
        projectHost: getSupabaseProjectHost(),
        error: contactsError?.message,
        details: contactsError?.details,
        hint: contactsError?.hint,
        code: contactsError?.code,
      });
    }

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
      contact_profile_picture_url:
        contact.profile_picture_url ?? conversation.contact_profile_picture_url ?? null,
    };
  });
}

export async function loadConversationMessages(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  limit = 300,
): Promise<MessageRecord[]> {
  const { data, error } = await supabase
    .from("instagram_messages")
    .select("*")
    .eq("owner_id", userId)
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
