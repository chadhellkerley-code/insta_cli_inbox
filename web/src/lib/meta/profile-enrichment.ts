import { getMetaOauthConfig, META_OAUTH_FLOW } from "@/lib/meta/config";
import {
  buildInstagramProfileEnrichmentDiagnostic,
  fetchInstagramAccountProfile,
  fetchInstagramUserProfile,
} from "@/lib/meta/client";
import { isFallbackInstagramUsername } from "@/lib/meta/instagram-username";
import { ensureInstagramAccessToken } from "@/lib/meta/token-lifecycle";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

type InstagramAccountProfileTarget = {
  id: string;
  instagram_account_id: string;
  access_token: string;
  token_expires_at?: string | null;
  username?: string | null;
  name?: string | null;
  profile_picture_url?: string | null;
};

type InstagramContactCacheRecord = {
  id: string;
  owner_id: string;
  contact_igsid: string;
  contact_username: string | null;
  contact_name: string | null;
  profile_picture_url: string | null;
  last_profile_fetch_at: string | null;
  last_profile_fetch_error: string | null;
};

type InstagramContactProfileTarget = {
  id: string;
  owner_id: string;
  access_token: string;
  token_expires_at?: string | null;
  last_oauth_at?: string | null;
};

type ResolvedInstagramContact = {
  contactUsername: string | null;
  contactName: string | null;
  profilePictureUrl: string | null;
};

function isMissingInstagramContactsTableError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error ?? "");
  const normalized = message.toLowerCase();

  return (
    normalized.includes("instagram_contacts") &&
    (normalized.includes("schema cache") ||
      normalized.includes("does not exist") ||
      normalized.includes("could not find the table"))
  );
}

function normalizeString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeUsername(value: string | null | undefined) {
  const normalized = normalizeString(value)?.replace(/^@+/, "") ?? null;

  if (!normalized || isFallbackInstagramUsername(normalized)) {
    return null;
  }

  return normalized;
}

function hasKnownContactIdentity(contact: Pick<
  InstagramContactCacheRecord,
  "contact_username" | "contact_name" | "profile_picture_url"
>) {
  return Boolean(
    normalizeUsername(contact.contact_username) ||
      normalizeString(contact.contact_name) ||
      normalizeString(contact.profile_picture_url),
  );
}

function hasNewerOauthThanLastFetch(options: {
  lastOauthAt?: string | null;
  lastProfileFetchAt?: string | null;
}) {
  if (!options.lastOauthAt) {
    return false;
  }

  const oauthMs = new Date(options.lastOauthAt).getTime();
  const fetchMs = options.lastProfileFetchAt
    ? new Date(options.lastProfileFetchAt).getTime()
    : Number.NaN;

  if (Number.isNaN(oauthMs)) {
    return false;
  }

  if (Number.isNaN(fetchMs)) {
    return true;
  }

  return oauthMs > fetchMs;
}

export function getInstagramContactDisplayProfile(contact: {
  contact_username?: string | null;
  contact_name?: string | null;
  profile_picture_url?: string | null;
}) {
  return {
    contactUsername: normalizeUsername(contact.contact_username),
    contactName: normalizeString(contact.contact_name),
    profilePictureUrl: normalizeString(contact.profile_picture_url),
  } satisfies ResolvedInstagramContact;
}

export async function syncInstagramAccountProfile(options: {
  admin: AdminClient;
  account: InstagramAccountProfileTarget;
}) {
  const oauthConfig = getMetaOauthConfig();

  if (oauthConfig.flow === META_OAUTH_FLOW) {
    return {
      username: normalizeUsername(options.account.username),
      name: normalizeString(options.account.name),
      profilePictureUrl: normalizeString(options.account.profile_picture_url),
      updated: false,
      diagnostic: buildInstagramProfileEnrichmentDiagnostic({
        instagramUserId: options.account.instagram_account_id,
        tokenLifecycle: "oauth",
      }),
    };
  }

  const managedToken = await ensureInstagramAccessToken({
    accessToken: options.account.access_token,
    expiresAt: options.account.token_expires_at ?? null,
  });
  const profile = await fetchInstagramAccountProfile({
    accessToken: managedToken.accessToken,
  });
  const currentUsername = normalizeUsername(options.account.username);
  const nextUsername = normalizeUsername(profile.username) ?? currentUsername;
  const nextName = normalizeString(profile.name) ?? normalizeString(options.account.name);
  const nextProfilePictureUrl =
    normalizeString(profile.profilePictureUrl) ??
    normalizeString(options.account.profile_picture_url);

  const needsUsernameUpdate =
    nextUsername !== null && nextUsername !== currentUsername;
  const needsNameUpdate =
    nextName !== null && nextName !== normalizeString(options.account.name);
  const needsProfilePictureUpdate =
    nextProfilePictureUrl !== null &&
    nextProfilePictureUrl !== normalizeString(options.account.profile_picture_url);

  if (!needsUsernameUpdate && !needsNameUpdate && !needsProfilePictureUpdate) {
    return {
      username: nextUsername,
      name: nextName,
      profilePictureUrl: nextProfilePictureUrl,
      updated: false,
    };
  }

  const updatePayload: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };

  if (needsUsernameUpdate && nextUsername) {
    updatePayload.username = nextUsername;
  }

  if (needsNameUpdate && nextName) {
    updatePayload.name = nextName;
  }

  if (needsProfilePictureUpdate && nextProfilePictureUrl) {
    updatePayload.profile_picture_url = nextProfilePictureUrl;
  }

  const updateResult = await options.admin
    .from("instagram_accounts")
    .update(updatePayload as never)
    .eq("id", options.account.id);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  if (needsUsernameUpdate && nextUsername) {
    options.account.username = nextUsername;
  }

  if (needsNameUpdate && nextName) {
    options.account.name = nextName;
  }

  if (needsProfilePictureUpdate && nextProfilePictureUrl) {
    options.account.profile_picture_url = nextProfilePictureUrl;
  }

  return {
    username: nextUsername,
    name: nextName,
    profilePictureUrl: nextProfilePictureUrl,
    updated: true,
  };
}

export async function resolveInstagramContactProfile(options: {
  admin: AdminClient;
  account: InstagramContactProfileTarget;
  contactIgsid: string;
}) {
  const existingResult = await options.admin
    .from("instagram_contacts")
    .select(
      "id, owner_id, contact_igsid, contact_username, contact_name, profile_picture_url, last_profile_fetch_at, last_profile_fetch_error",
    )
    .eq("owner_id", options.account.owner_id)
    .eq("contact_igsid", options.contactIgsid)
    .maybeSingle();
  const existing = existingResult.data as InstagramContactCacheRecord | null;
  const canUseContactsCache = !existingResult.error;

  if (existingResult.error) {
    if (!isMissingInstagramContactsTableError(existingResult.error)) {
      throw new Error(existingResult.error.message);
    }
  }

  if (existing && hasKnownContactIdentity(existing)) {
    return getInstagramContactDisplayProfile(existing);
  }

  const shouldRetryFetch =
    !existing ||
    !existing.last_profile_fetch_at ||
    hasNewerOauthThanLastFetch({
      lastOauthAt: options.account.last_oauth_at,
      lastProfileFetchAt: existing.last_profile_fetch_at,
    });

  if (!shouldRetryFetch && existing) {
    return getInstagramContactDisplayProfile(existing);
  }

  const attemptedAt = new Date().toISOString();

  try {
    const managedToken = await ensureInstagramAccessToken({
      accessToken: options.account.access_token,
      expiresAt: options.account.token_expires_at ?? null,
    });
    const profile = await fetchInstagramUserProfile({
      accessToken: managedToken.accessToken,
      igScopedId: options.contactIgsid,
    });
    const resolved = {
      contactUsername: normalizeUsername(profile.username),
      contactName: normalizeString(profile.name),
      profilePictureUrl: normalizeString(profile.profilePictureUrl),
    } satisfies ResolvedInstagramContact;

    if (!canUseContactsCache) {
      return resolved;
    }

    const upsertResult = await options.admin.from("instagram_contacts").upsert(
      {
        owner_id: options.account.owner_id,
        contact_igsid: options.contactIgsid,
        contact_username: resolved.contactUsername ?? existing?.contact_username ?? null,
        contact_name: resolved.contactName ?? existing?.contact_name ?? null,
        profile_picture_url:
          resolved.profilePictureUrl ?? existing?.profile_picture_url ?? null,
        last_profile_fetch_at: attemptedAt,
        last_profile_fetch_error: null,
        updated_at: attemptedAt,
      } as never,
      {
        onConflict: "owner_id,contact_igsid",
      },
    );

    if (upsertResult.error) {
      if (isMissingInstagramContactsTableError(upsertResult.error)) {
        return resolved;
      }

      throw new Error(upsertResult.error.message);
    }

    return resolved;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!canUseContactsCache) {
      return existing
        ? getInstagramContactDisplayProfile(existing)
        : {
            contactUsername: null,
            contactName: null,
            profilePictureUrl: null,
          };
    }

    const upsertResult = await options.admin.from("instagram_contacts").upsert(
      {
        owner_id: options.account.owner_id,
        contact_igsid: options.contactIgsid,
        contact_username: existing?.contact_username ?? null,
        contact_name: existing?.contact_name ?? null,
        profile_picture_url: existing?.profile_picture_url ?? null,
        last_profile_fetch_at: attemptedAt,
        last_profile_fetch_error: message,
        updated_at: attemptedAt,
      } as never,
      {
        onConflict: "owner_id,contact_igsid",
      },
    );

    if (upsertResult.error) {
      if (isMissingInstagramContactsTableError(upsertResult.error)) {
        return existing
          ? getInstagramContactDisplayProfile(existing)
          : {
              contactUsername: null,
              contactName: null,
              profilePictureUrl: null,
            };
      }

      throw new Error(upsertResult.error.message);
    }

    return existing ? getInstagramContactDisplayProfile(existing) : {
      contactUsername: null,
      contactName: null,
      profilePictureUrl: null,
    };
  }
}
