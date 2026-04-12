import { getMetaOauthConfig, getMetaServerEnv } from "@/lib/meta/config";
import type { ExactValueComparison } from "@/lib/meta/oauth-observability";

type MetaErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
  error_type?: string;
  error_message?: string;
  code?: number;
  error_code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

type ShortLivedTokenPayload = {
  access_token?: string;
  user_id?: string | number;
  permissions?: string | string[];
  expires_in?: number;
};

type RawShortLivedTokenResponse = ShortLivedTokenPayload & {
  data?: ShortLivedTokenPayload[];
};

type ShortLivedTokenResponse = {
  access_token: string;
  user_id?: string;
  permissions?: string[];
  expires_in?: number;
};

export type InstagramProfileEnrichmentDiagnostic = {
  status: "pending";
  instagramUserId: string;
  fallbackUsername: string;
  reason: string;
  nextAction: string;
};

function normalizeMetaIdentifier(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function normalizePermissions(permissions?: string | string[] | null) {
  if (Array.isArray(permissions)) {
    return permissions.map((permission) => permission.trim()).filter(Boolean);
  }

  if (typeof permissions === "string") {
    return permissions
      .split(",")
      .map((permission) => permission.trim())
      .filter(Boolean);
  }

  return undefined;
}

function summarizeMetaError(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const errorPayload = payload as MetaErrorPayload;

  return {
    message: errorPayload.error?.message ?? errorPayload.error_message ?? null,
    type: errorPayload.error?.type ?? errorPayload.error_type ?? null,
    code:
      errorPayload.error?.code ?? errorPayload.code ?? errorPayload.error_code ?? null,
    subcode: errorPayload.error?.error_subcode ?? errorPayload.error_subcode ?? null,
    fbtraceId: errorPayload.fbtrace_id ?? null,
  };
}

function getMetaErrorMessage(payload: unknown) {
  return summarizeMetaError(payload)?.message ?? "Meta rejected the request.";
}

async function readMetaJson(response: Response) {
  return (await response.json().catch(() => null)) as unknown;
}

function assertMetaResponseOk(response: Response, payload: unknown, context: string) {
  if (response.ok) {
    return;
  }

  const message = getMetaErrorMessage(payload);
  throw new Error(`${context}: ${message}`);
}

export function buildMetaOauthUrl(state: string) {
  const { appId } = getMetaServerEnv();
  const oauthConfig = getMetaOauthConfig();
  const url = new URL(oauthConfig.authorizeUrl);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("enable_fb_login", "false");
  url.searchParams.set("redirect_uri", oauthConfig.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", oauthConfig.scopes.join(","));
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeCodeForShortLivedToken(
  code: string,
  redirectUri: string,
  options?: {
    codeFingerprint?: string;
    redirectUriComparison?: ExactValueComparison;
  },
): Promise<ShortLivedTokenResponse> {
  const { appId, appSecret } = getMetaServerEnv();
  const oauthConfig = getMetaOauthConfig();
  const body = new URLSearchParams();
  body.set("client_id", appId);
  body.set("client_secret", appSecret);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", redirectUri);
  body.set("code", code);

  console.info("[meta-oauth] short-lived token exchange request", {
    flow: oauthConfig.flow,
    endpoint: oauthConfig.shortLivedTokenUrl,
    appId,
    callbackPath: oauthConfig.callbackPath,
    redirectUriUsedForExchange: redirectUri,
    redirectUriMatchesCanonical: options?.redirectUriComparison?.exact ?? null,
    redirectUriComparison: options?.redirectUriComparison ?? null,
    requestFormat: "application/x-www-form-urlencoded",
    codeFingerprint: options?.codeFingerprint ?? null,
    codeLength: code.length,
  });

  const response = await fetch(oauthConfig.shortLivedTokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
    cache: "no-store",
  });
  const payload = await readMetaJson(response);

  console.info("[meta-oauth] short-lived token exchange response", {
    endpoint: oauthConfig.shortLivedTokenUrl,
    status: response.status,
    ok: response.ok,
    externalError: summarizeMetaError(payload),
  });

  assertMetaResponseOk(response, payload, "Short-lived token exchange failed");

  const typedPayload = payload as RawShortLivedTokenResponse;
  const tokenPayload = Array.isArray(typedPayload.data)
    ? typedPayload.data[0]
    : typedPayload;

  if (!tokenPayload?.access_token) {
    throw new Error("Meta did not return an access token.");
  }

  return {
    access_token: tokenPayload.access_token,
    user_id: normalizeMetaIdentifier(tokenPayload.user_id) ?? undefined,
    permissions: normalizePermissions(tokenPayload.permissions),
    expires_in: tokenPayload.expires_in,
  };
}

export function buildInstagramProfileEnrichmentDiagnostic(options: {
  instagramUserId: string;
  tokenLifecycle?: string | null;
}): InstagramProfileEnrichmentDiagnostic {
  return {
    status: "pending",
    instagramUserId: options.instagramUserId,
    fallbackUsername: `ig_${options.instagramUserId}`,
    reason:
      "Instagram Login tokens from api.instagram.com/oauth/access_token are not valid for the profile read paths observed during callback diagnostics.",
    nextAction:
      `Run profile enrichment later with a supported endpoint for this token type. Current token lifecycle: ${options.tokenLifecycle ?? "unknown"}.`,
  };
}

export async function sendInstagramMessage(options: {
  accessToken: string;
  instagramAccountId: string;
  recipientId: string;
  text?: string;
  messageType?: "audio" | "image" | "video" | "file";
  mediaUrl?: string;
}) {
  const oauthConfig = getMetaOauthConfig();
  const url = new URL(`${oauthConfig.graphBaseUrl}/${options.instagramAccountId}/messages`);

  const message =
    options.messageType && options.mediaUrl
      ? options.messageType === "image"
        ? {
            attachments: [
              {
                type: options.messageType,
                payload: {
                  url: options.mediaUrl,
                },
              },
            ],
          }
        : {
            attachment: {
              type: options.messageType,
              payload: {
                url: options.mediaUrl,
              },
            },
          }
      : {
          text: options.text,
        };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      recipient: {
        id: options.recipientId,
      },
      message,
    }),
    cache: "no-store",
  });

  const responsePayload = await readMetaJson(response);
  assertMetaResponseOk(response, responsePayload, "Send message failed");

  return responsePayload as {
    recipient_id?: string;
    message_id?: string;
  };
}
