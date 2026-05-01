import { NextResponse } from "next/server";

import { persistInstagramAccountIdentifiers } from "@/lib/meta/account-identifiers";
import {
  exchangeInstagramTokenForLongLivedToken,
  fetchInstagramLoginAccountIdentity,
} from "@/lib/meta/client";
import { buildFallbackInstagramUsername } from "@/lib/meta/instagram-username";
import {
  persistInstagramAccountReadiness,
  runInstagramPostOauthActivation,
} from "@/lib/meta/oauth-activation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ConnectManualBody = {
  accessToken?: string;
  instagramAccountId?: string;
};

type ExistingAccountLookup = {
  id: string;
  owner_id: string;
  instagram_user_id: string | null;
  instagram_account_id: string;
  page_id: string | null;
  instagram_app_user_id: string | null;
  username: string | null;
  name: string | null;
  account_type: string | null;
  profile_picture_url: string | null;
};

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function pickExistingInstagramAccount(
  accounts: ExistingAccountLookup[],
  options: {
    instagramAccountId: string;
    instagramUserId: string;
    instagramAppUserId: string | null;
  },
) {
  const exactAccountIdMatch = accounts.find(
    (account) => account.instagram_account_id === options.instagramAccountId,
  );

  if (exactAccountIdMatch) {
    return exactAccountIdMatch;
  }

  const exactUserIdMatch = accounts.find(
    (account) => account.instagram_user_id === options.instagramUserId,
  );

  if (exactUserIdMatch) {
    return exactUserIdMatch;
  }

  if (!options.instagramAppUserId) {
    return null;
  }

  return (
    accounts.find(
      (account) => account.instagram_app_user_id === options.instagramAppUserId,
    ) ?? null
  );
}

async function normalizeManualToken(accessToken: string) {
  try {
    const exchangedToken = await exchangeInstagramTokenForLongLivedToken({
      shortLivedAccessToken: accessToken,
    });

    const expiresIn = exchangedToken.expiresIn ?? 60 * 24 * 60 * 60;

    return {
      accessToken: exchangedToken.accessToken,
      expiresIn,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      lifecycle: "oauth_long_lived" as const,
    };
  } catch (error) {
    console.warn("[instagram-manual-connect] long-lived exchange skipped", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const fallbackExpiresIn = 60 * 24 * 60 * 60;

  return {
    accessToken,
    expiresIn: fallbackExpiresIn,
    expiresAt: new Date(Date.now() + fallbackExpiresIn * 1000).toISOString(),
    lifecycle: "oauth_long_lived" as const,
  };
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ConnectManualBody | null;
  const accessToken = body?.accessToken?.trim();
  const fallbackInstagramAccountId = body?.instagramAccountId?.trim() || null;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Falta el access token para conectar la cuenta." },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();
    const managedToken = await normalizeManualToken(accessToken);
    const remoteIdentity = await fetchInstagramLoginAccountIdentity({
      accessToken: managedToken.accessToken,
    });
    const instagramUserId = remoteIdentity.appScopedUserId ?? fallbackInstagramAccountId;
    const resolvedInstagramAccountId =
      remoteIdentity.instagramAccountId ??
      fallbackInstagramAccountId ??
      remoteIdentity.appScopedUserId;

    if (!instagramUserId || !resolvedInstagramAccountId) {
      throw new Error(
        "No pudimos identificar la cuenta desde el token. Si tenes el Instagram account ID, cargalo manualmente.",
      );
    }

    const lookupFilters = [
      `instagram_account_id.eq.${resolvedInstagramAccountId}`,
      `instagram_user_id.eq.${instagramUserId}`,
      remoteIdentity.appScopedUserId
        ? `instagram_app_user_id.eq.${remoteIdentity.appScopedUserId}`
        : null,
    ].filter(Boolean) as string[];
    const existingResult = await admin
      .from("instagram_accounts")
      .select(
        "id, owner_id, instagram_user_id, instagram_account_id, page_id, instagram_app_user_id, username, name, account_type, profile_picture_url",
      )
      .or(lookupFilters.join(","));
    const existingAccounts = (existingResult.data as ExistingAccountLookup[] | null) ?? [];
    const existing = pickExistingInstagramAccount(existingAccounts, {
      instagramAccountId: resolvedInstagramAccountId,
      instagramUserId,
      instagramAppUserId: remoteIdentity.appScopedUserId ?? null,
    });

    if (existingResult.error) {
      throw new Error(existingResult.error.message);
    }

    if (existing && existing.owner_id !== user.id) {
      throw new Error("Esta cuenta de Instagram ya esta conectada a otro usuario del CRM.");
    }

    const resolvedUsername =
      normalizeOptionalString(remoteIdentity.username) ??
      normalizeOptionalString(existing?.username) ??
      buildFallbackInstagramUsername(resolvedInstagramAccountId);
    const nowIso = new Date().toISOString();

    const mutation = {
      owner_id: user.id,
      instagram_user_id: instagramUserId,
      instagram_account_id: resolvedInstagramAccountId,
      instagram_app_user_id:
        remoteIdentity.appScopedUserId ?? existing?.instagram_app_user_id ?? null,
      page_id: existing?.page_id ?? null,
      username: resolvedUsername,
      name: existing?.name ?? null,
      account_type:
        normalizeOptionalString(remoteIdentity.accountType) ??
        normalizeOptionalString(existing?.account_type),
      profile_picture_url: existing?.profile_picture_url ?? null,
      access_token: managedToken.accessToken,
      token_obtained_at: nowIso,
      expires_in: managedToken.expiresIn,
      expires_at: managedToken.expiresAt,
      token_expires_at: managedToken.expiresAt,
      token_lifecycle: managedToken.lifecycle,
      last_token_refresh_at: nowIso,
      status: "oauth_connected",
      webhook_subscribed_at: null,
      webhook_status: "pending",
      messaging_status: "pending",
      last_webhook_check_at: null,
      webhook_subscription_error: null,
      last_oauth_at: nowIso,
      updated_at: nowIso,
    };
    const updateMutation = mutation;
    const insertMutation = {
      ...mutation,
      connected_at: nowIso,
    };

    const upsertResult = existing
      ? await admin
          .from("instagram_accounts")
          .update(updateMutation as never)
          .eq("id", existing.id)
          .select("id, owner_id, instagram_user_id, instagram_account_id, instagram_app_user_id")
          .maybeSingle()
      : await admin
          .from("instagram_accounts")
          .insert(insertMutation as never)
          .select("id, owner_id, instagram_user_id, instagram_account_id, instagram_app_user_id")
          .maybeSingle();
    const upsertedAccount = upsertResult.data as {
      id: string;
      owner_id: string;
      instagram_user_id: string | null;
      instagram_account_id: string;
      instagram_app_user_id: string | null;
    } | null;

    if (upsertResult.error || !upsertedAccount) {
      throw new Error(upsertResult.error?.message ?? "No pudimos guardar la cuenta de Instagram.");
    }

    await persistInstagramAccountIdentifiers({
      admin,
      accountId: upsertedAccount.id,
      identifiers: [
        {
          identifier: upsertedAccount.instagram_user_id,
          identifierType: "instagram_user_id",
        },
        {
          identifier: upsertedAccount.instagram_account_id,
          identifierType: "instagram_account_id",
        },
        {
          identifier: upsertedAccount.instagram_app_user_id,
          identifierType: "instagram_app_user_id",
        },
      ],
    });

    const readiness = await runInstagramPostOauthActivation({
      instagram_account_id: upsertedAccount.instagram_account_id,
      page_id: existing?.page_id ?? null,
      access_token: managedToken.accessToken,
      token_expires_at: managedToken.expiresAt,
      scopes: null,
    });

    await persistInstagramAccountReadiness({
      admin,
      accountId: upsertedAccount.id,
      readiness,
    });

    return NextResponse.json({
      ok: true,
      message: `Cuenta conectada correctamente como @${resolvedUsername}.`,
      accountId: upsertedAccount.id,
      instagramAccountId: upsertedAccount.instagram_account_id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No pudimos conectar la cuenta con token.",
      },
      { status: 500 },
    );
  }
}
