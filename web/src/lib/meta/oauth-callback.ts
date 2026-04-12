import { NextResponse, type NextRequest } from "next/server";

import {
  exchangeCodeForShortLivedToken,
  fetchInstagramAccountProfile,
} from "@/lib/meta/client";
import {
  getMetaCanonicalRedirectConfig,
  getMetaOauthConfig,
  META_LOGIN_SCOPES,
} from "@/lib/meta/config";
import {
  attachStoredMetaOauthResult,
  readStoredMetaOauthResult,
  type MetaOauthCompletionPayload,
} from "@/lib/meta/oauth-callback-result";
import {
  compareExactValues,
  createOpaqueFingerprint,
} from "@/lib/meta/oauth-observability";
import { verifyMetaOauthState } from "@/lib/meta/oauth-state";
import { resolveInitialInstagramToken } from "@/lib/meta/token-lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";

type ExistingAccountLookup = {
  id: string;
  owner_id: string;
};

function buildFallbackInstagramUsername(instagramAccountId: string) {
  return `ig_${instagramAccountId}`;
}

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

function buildRedirectMismatchMessage(comparison: ReturnType<typeof compareExactValues>) {
  if (comparison.exact) {
    return null;
  }

  return `META_OAUTH_REDIRECT_URI no coincide exactamente con el redirect_uri firmado en el authorize step. firstDiffIndex=${comparison.firstDiffIndex}, expectedLength=${comparison.expectedLength}, actualLength=${comparison.actualLength}.`;
}

function createMetaOauthCompletionResponse(
  origin: string,
  params: MetaOauthCompletionPayload,
  options?: {
    code?: string;
  },
) {
  const response = NextResponse.redirect(
    buildMetaOauthCompletionUrl(origin, {
      status: params.status,
      message: params.message,
      ...(params.username ? { username: params.username } : {}),
      ...(params.helpUrl ? { helpUrl: params.helpUrl } : {}),
    }),
  );

  response.headers.set("Cache-Control", "no-store");

  if (options?.code) {
    attachStoredMetaOauthResult(response, options.code, params);
  }

  return response;
}

export async function handleCanonicalMetaOauthCallback(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");
  const errorReason = requestUrl.searchParams.get("error_reason");
  const errorDescription = requestUrl.searchParams.get("error_description");
  const oauthState = verifyMetaOauthState(state);
  const oauthConfig = getMetaOauthConfig();
  const redirectConfig = getMetaCanonicalRedirectConfig();
  const stateRedirectUri = oauthState?.redirectUri ?? null;
  const redirectUriComparison = oauthState
    ? compareExactValues(redirectConfig.redirectUri, oauthState.redirectUri)
    : null;
  const codeFingerprint = code ? createOpaqueFingerprint(code) : null;
  const storedResult = code ? readStoredMetaOauthResult(request, code) : null;

  console.info("[meta-oauth] callback received", {
    flow: oauthConfig.flow,
    route: requestUrl.pathname,
    callbackUrl: requestUrl.toString(),
    canonicalCallbackPath: redirectConfig.callbackPath,
    canonicalRedirectUri: redirectConfig.redirectUri,
    stateRedirectUri,
    redirectUriMatchesCanonical: redirectUriComparison?.exact ?? null,
    redirectUriComparison,
    hasCode: Boolean(code),
    codeFingerprint,
    codeLength: code?.length ?? 0,
    hasState: Boolean(state),
    stateLength: state?.length ?? 0,
    stateValid: Boolean(oauthState),
    duplicateCallbackDetected: Boolean(storedResult),
    error,
    errorReason,
    errorDescription,
  });

  if (code && storedResult) {
    console.warn("[meta-oauth] duplicate callback replay detected", {
      flow: oauthConfig.flow,
      route: requestUrl.pathname,
      codeFingerprint,
      redirectUriMatchesCanonical: redirectUriComparison?.exact ?? null,
      completionStatus: storedResult.status,
    });

    return createMetaOauthCompletionResponse(origin, storedResult, { code });
  }

  if (error) {
    return createMetaOauthCompletionResponse(origin, {
      status: "error",
      message: errorDescription || "Meta cancelo o rechazo la autorizacion.",
    });
  }

  if (!code || !oauthState) {
    return createMetaOauthCompletionResponse(origin, {
      status: "error",
      message: "No pudimos validar la autorizacion de Meta.",
    });
  }

  if (!redirectUriComparison) {
    return createMetaOauthCompletionResponse(
      origin,
      {
        status: "error",
        message: "No pudimos validar el redirect_uri firmado para completar la autorizacion.",
      },
      { code },
    );
  }

  if (!redirectUriComparison.exact) {
    const redirectMismatchMessage = buildRedirectMismatchMessage(redirectUriComparison);

    console.error("[meta-oauth] redirect URI mismatch detected before token exchange", {
      flow: oauthConfig.flow,
      route: requestUrl.pathname,
      codeFingerprint,
      canonicalRedirectUri: redirectConfig.redirectUri,
      stateRedirectUri,
      redirectUriComparison,
      tokenExchangeEndpoint: oauthConfig.shortLivedTokenUrl,
    });

    return createMetaOauthCompletionResponse(
      origin,
      {
        status: "error",
        message: `${redirectMismatchMessage} Verifica en Meta Dashboard > Instagram > API setup with Instagram login > Business login settings que OAuth redirect URIs tenga exactamente ${redirectConfig.redirectUri}.`,
      },
      { code },
    );
  }

  try {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const userResult = await admin.auth.admin.getUserById(oauthState.userId);

    if (userResult.error || !userResult.data.user) {
      return createMetaOauthCompletionResponse(
        origin,
        {
          status: "error",
          message: "No pudimos validar el usuario para completar la conexion.",
        },
        { code },
      );
    }

    const shortLivedToken = await exchangeCodeForShortLivedToken(code, oauthState.redirectUri, {
      codeFingerprint: codeFingerprint ?? undefined,
      redirectUriComparison,
    });
    const managedToken = await resolveInitialInstagramToken(shortLivedToken);
    const instagramAccountId = shortLivedToken.user_id ?? null;
    let hydratedProfile: {
      user_id: string | null;
      username: string | null;
      name: string | null;
      account_type: string | null;
      profile_picture_url: string | null;
    } | null = null;

    try {
      hydratedProfile = await fetchInstagramAccountProfile({
        accessToken: managedToken.accessToken,
      });
      console.info("[meta-oauth] instagram profile hydrated", {
        instagramUserId: hydratedProfile.user_id,
        username: hydratedProfile.username,
        accountType: hydratedProfile.account_type,
        hasProfilePicture: Boolean(hydratedProfile.profile_picture_url),
      });
    } catch (error) {
      console.error("[meta-oauth] instagram profile hydration failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const resolvedInstagramAccountId =
      hydratedProfile?.user_id ?? shortLivedToken.user_id ?? instagramAccountId;

    if (!resolvedInstagramAccountId) {
      throw new Error("Meta no devolvio el identificador de la cuenta de Instagram.");
    }

    const resolvedInstagramAppUserId = resolvedInstagramAccountId;
    const resolvedUsername =
      hydratedProfile?.username ?? buildFallbackInstagramUsername(resolvedInstagramAccountId);

    const existingResult = await admin
      .from("instagram_accounts")
      .select("id, owner_id")
      .eq("instagram_account_id", resolvedInstagramAccountId)
      .maybeSingle();
    const existing = existingResult.data as ExistingAccountLookup | null;

    if (existingResult.error) {
      throw new Error(existingResult.error.message);
    }

    if (existing && existing.owner_id !== oauthState.userId) {
      throw new Error("Esta cuenta de Instagram ya esta conectada a otro usuario del CRM.");
    }

    const upsertResult = await admin.from("instagram_accounts").upsert(
      {
        owner_id: oauthState.userId,
        instagram_account_id: resolvedInstagramAccountId,
        instagram_app_user_id: resolvedInstagramAppUserId,
        username: resolvedUsername,
        name: hydratedProfile?.name ?? null,
        account_type: hydratedProfile?.account_type ?? null,
        profile_picture_url: hydratedProfile?.profile_picture_url ?? null,
        access_token: managedToken.accessToken,
        token_expires_at: managedToken.expiresAt,
        token_lifecycle: managedToken.lifecycle,
        last_token_refresh_at: nowIso,
        status: "connected",
        connected_at: nowIso,
        last_oauth_at: nowIso,
        scopes: shortLivedToken.permissions ?? Array.from(META_LOGIN_SCOPES),
        updated_at: nowIso,
      } as never,
      {
        onConflict: "instagram_account_id",
      },
    );

    if (upsertResult.error) {
      throw new Error(upsertResult.error.message);
    }

    return createMetaOauthCompletionResponse(
      origin,
      {
        status: "success",
        message: "Conectamos la cuenta de Instagram correctamente.",
        username: undefined,
      },
      { code },
    );
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = rawMessage.includes("redirect_uri")
      ? `Meta rechazo el intercambio del codigo porque el redirect_uri no coincide exactamente. Verifica en Meta Dashboard > Instagram > API setup with Instagram login > Business login settings que el OAuth redirect URI sea exactamente ${oauthState.redirectUri}.`
      : rawMessage;

    console.error("[meta-oauth] callback failed", {
      flow: oauthConfig.flow,
      route: requestUrl.pathname,
      callbackUrl: requestUrl.toString(),
      canonicalRedirectUri: redirectConfig.redirectUri,
      stateRedirectUri,
      redirectUriMatchesCanonical: redirectUriComparison.exact,
      redirectUriComparison,
      codeFingerprint,
      tokenExchangeEndpoint: oauthConfig.shortLivedTokenUrl,
      externalErrorMessage: rawMessage,
    });

    return createMetaOauthCompletionResponse(
      origin,
      {
        status: "error",
        message,
      },
      { code },
    );
  }
}
