import {
  getMetaOauthConfig,
  getMetaServerEnv,
} from "@/lib/meta/config";
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
  user_id?: string;
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

type LongLivedTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type MetaProfileResponse = {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
  data?: Array<{
    id?: string;
    user_id?: string;
    username?: string;
    name?: string;
    account_type?: string;
    profile_picture_url?: string;
  }>;
};

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
    user_id: tokenPayload.user_id,
    permissions: normalizePermissions(tokenPayload.permissions),
    expires_in: tokenPayload.expires_in,
  };
}

export async function exchangeForLongLivedToken(shortLivedToken: string) {
  const oauthConfig = getMetaOauthConfig();
  const { appSecret } = getMetaServerEnv();
  const body = new URLSearchParams();
  body.set("grant_type", "ig_exchange_token");
  body.set("client_secret", appSecret);
  body.set("access_token", shortLivedToken);

  console.info("[meta-oauth] long-lived token exchange request", {
    flow: oauthConfig.flow,
    endpoint: oauthConfig.longLivedTokenUrl,
    grantType: "ig_exchange_token",
    requestFormat: "application/x-www-form-urlencoded",
  });

  const response = await fetch(oauthConfig.longLivedTokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
    cache: "no-store",
  });
  const payload = await readMetaJson(response);

  console.info("[meta-oauth] long-lived token exchange response", {
    endpoint: oauthConfig.longLivedTokenUrl,
    status: response.status,
    ok: response.ok,
    expiresIn:
      payload && typeof payload === "object" && "expires_in" in payload
        ? (payload as LongLivedTokenResponse).expires_in ?? null
        : null,
    error: summarizeMetaError(payload),
  });

  assertMetaResponseOk(response, payload, "Long-lived token exchange failed");

  return payload as LongLivedTokenResponse;
}

export async function fetchInstagramProfile(accessToken: string) {
  const oauthConfig = getMetaOauthConfig();
  const url = new URL(`${oauthConfig.graphBaseUrl}/me`);
  url.searchParams.set(
    "fields",
    "id,user_id,username,account_type,name,profile_picture_url",
  );
  url.searchParams.set("access_token", accessToken);

  console.info("[meta-oauth] profile fetch request", {
    flow: oauthConfig.flow,
    endpoint: `${oauthConfig.graphBaseUrl}/me`,
    fields: url.searchParams.get("fields"),
  });

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });
  const payload = await readMetaJson(response);

  console.info("[meta-oauth] profile fetch response", {
    endpoint: `${oauthConfig.graphBaseUrl}/me`,
    status: response.status,
    ok: response.ok,
    error: summarizeMetaError(payload),
  });

  assertMetaResponseOk(response, payload, "Profile fetch failed");

  const typedPayload = payload as MetaProfileResponse;
  const profile = Array.isArray(typedPayload.data) ? typedPayload.data[0] : typedPayload;

  return {
    appScopedUserId: profile.id ?? null,
    instagramAccountId: profile.user_id ?? profile.id ?? null,
    username: profile.username ?? null,
    name: profile.name ?? null,
    accountType: profile.account_type ?? null,
    profilePictureUrl: profile.profile_picture_url ?? null,
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
