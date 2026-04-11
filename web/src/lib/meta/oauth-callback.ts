import { NextResponse } from "next/server";

import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  fetchInstagramProfile,
} from "@/lib/meta/client";
import {
  getMetaCanonicalRedirectUri,
  getMetaOauthConfig,
  isProfessionalAccountType,
  META_LOGIN_SCOPES,
  PROFESSIONAL_ACCOUNT_HELP_URL,
} from "@/lib/meta/config";
import { verifyMetaOauthState } from "@/lib/meta/oauth-state";
import { createAdminClient } from "@/lib/supabase/admin";

type ExistingAccountLookup = {
  id: string;
  owner_id: string;
};

export function buildMetaOauthCompletionUrl(
  origin: string,
  params: Record<string, string>,
) {
  const url = new URL("/meta/oauth/complete", origin);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url;
}

export async function handleCanonicalMetaOauthCallback(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");
  const errorReason = requestUrl.searchParams.get("error_reason");
  const errorDescription = requestUrl.searchParams.get("error_description");
  const oauthState = verifyMetaOauthState(state);
  const oauthConfig = getMetaOauthConfig();
  const canonicalRedirectUri = getMetaCanonicalRedirectUri();

  console.info("[meta-oauth] callback received", {
    flow: oauthConfig.flow,
    route: requestUrl.pathname,
    callbackUrl: requestUrl.toString(),
    canonicalRedirectUri,
    hasCode: Boolean(code),
    codeLength: code?.length ?? 0,
    hasState: Boolean(state),
    stateLength: state?.length ?? 0,
    stateValid: Boolean(oauthState),
    error,
    errorReason,
    errorDescription,
  });

  if (error) {
    return NextResponse.redirect(
      buildMetaOauthCompletionUrl(origin, {
        status: "error",
        message: errorDescription || "Meta cancelo o rechazo la autorizacion.",
      }),
    );
  }

  if (!code || !oauthState) {
    return NextResponse.redirect(
      buildMetaOauthCompletionUrl(origin, {
        status: "error",
        message: "No pudimos validar la autorizacion de Meta.",
      }),
    );
  }

  try {
    const admin = createAdminClient();
    const userResult = await admin.auth.admin.getUserById(oauthState.userId);

    if (userResult.error || !userResult.data.user) {
      return NextResponse.redirect(
        buildMetaOauthCompletionUrl(origin, {
          status: "error",
          message: "No pudimos validar el usuario para completar la conexion.",
        }),
      );
    }

    const shortLivedToken = await exchangeCodeForShortLivedToken(code);
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken.access_token);
    const profile = await fetchInstagramProfile(longLivedToken.access_token);

    console.info("[meta-oauth] profile resolved", {
      flow: oauthConfig.flow,
      appScopedUserId: profile.appScopedUserId,
      instagramAccountId: profile.instagramAccountId,
      username: profile.username,
      accountType: profile.accountType,
    });

    if (
      !profile.instagramAccountId ||
      !profile.username ||
      !isProfessionalAccountType(profile.accountType)
    ) {
      return NextResponse.redirect(
        buildMetaOauthCompletionUrl(origin, {
          status: "error",
          message:
            "La cuenta conectada no es Professional. Cambiala a Business o Creator e intentalo otra vez.",
          helpUrl: PROFESSIONAL_ACCOUNT_HELP_URL,
        }),
      );
    }

    const existingResult = await admin
      .from("instagram_accounts")
      .select("id, owner_id")
      .eq("instagram_account_id", profile.instagramAccountId)
      .maybeSingle();
    const existing = existingResult.data as ExistingAccountLookup | null;

    if (existingResult.error) {
      throw new Error(existingResult.error.message);
    }

    if (existing && existing.owner_id !== oauthState.userId) {
      throw new Error("Esta cuenta de Instagram ya esta conectada a otro usuario del CRM.");
    }

    const expiresAt = new Date(
      Date.now() + (longLivedToken.expires_in ?? 60 * 24 * 60 * 60) * 1000,
    ).toISOString();

    const upsertResult = await admin.from("instagram_accounts").upsert(
      {
        owner_id: oauthState.userId,
        instagram_account_id: profile.instagramAccountId,
        instagram_app_user_id: profile.appScopedUserId,
        username: profile.username,
        name: profile.name,
        account_type: profile.accountType,
        profile_picture_url: profile.profilePictureUrl,
        access_token: longLivedToken.access_token,
        token_expires_at: expiresAt,
        status: "connected",
        connected_at: new Date().toISOString(),
        scopes: shortLivedToken.permissions ?? Array.from(META_LOGIN_SCOPES),
        updated_at: new Date().toISOString(),
      } as never,
      {
        onConflict: "instagram_account_id",
      },
    );

    if (upsertResult.error) {
      throw new Error(upsertResult.error.message);
    }

    return NextResponse.redirect(
      buildMetaOauthCompletionUrl(origin, {
        status: "success",
        message: `Conectamos @${profile.username} correctamente.`,
        username: profile.username,
      }),
    );
  } catch (error) {
    console.error("[meta-oauth] callback failed", {
      flow: oauthConfig.flow,
      route: requestUrl.pathname,
      callbackUrl: requestUrl.toString(),
      canonicalRedirectUri,
      message: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.redirect(
      buildMetaOauthCompletionUrl(origin, {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "No pudimos completar la conexion con Meta.",
      }),
    );
  }
}
