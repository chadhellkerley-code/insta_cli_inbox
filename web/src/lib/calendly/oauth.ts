import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "crypto";

export const CALENDLY_API_BASE_URL = "https://api.calendly.com";
export const CALENDLY_AUTHORIZE_URL = "https://auth.calendly.com/oauth/authorize";
export const CALENDLY_TOKEN_URL = "https://auth.calendly.com/oauth/token";
export const CALENDLY_OAUTH_CALLBACK_PATH = "/api/calendly/oauth/callback";

const STATE_TTL_SECONDS = 10 * 60;
const TOKEN_REFRESH_SKEW_SECONDS = 5 * 60;
const DEFAULT_CALENDLY_OAUTH_SCOPES =
  "users:read event_types:read scheduling_links:write";

type CalendlyOauthStatePayload = {
  v: 1;
  uid: string;
  rdu: string;
  nonce: string;
  exp: number;
};

export type CalendlyTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  expiresIn: number | null;
  tokenType: string | null;
};

type RawCalendlyTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

type RawCalendlyCurrentUserResponse = {
  resource?: {
    uri?: string;
    name?: string | null;
    email?: string | null;
    current_organization?: string;
  };
};

type RawCalendlyEventTypesResponse = {
  collection?: Array<{
    uri?: string;
    name?: string;
    active?: boolean;
    scheduling_url?: string | null;
    duration?: number | null;
  }>;
};

type RawCalendlySchedulingLinkResponse = {
  resource?: {
    booking_url?: string;
    owner?: string;
    owner_type?: string;
  };
};

function readOptionalEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function readEnv(value: string | undefined, missingMessage: string) {
  const trimmed = readOptionalEnv(value);

  if (!trimmed) {
    throw new Error(missingMessage);
  }

  return trimmed;
}

function getCalendlyServerEnv() {
  const clientSecret = readEnv(
    process.env.CALENDLY_CLIENT_SECRET,
    "Missing required env: CALENDLY_CLIENT_SECRET.",
  );

  return {
    clientId: readEnv(
      process.env.CALENDLY_CLIENT_ID,
      "Missing required env: CALENDLY_CLIENT_ID.",
    ),
    clientSecret,
    scopes:
      readOptionalEnv(process.env.CALENDLY_OAUTH_SCOPES) ??
      DEFAULT_CALENDLY_OAUTH_SCOPES,
    stateSecret:
      readOptionalEnv(process.env.CALENDLY_OAUTH_STATE_SECRET) ?? clientSecret,
  };
}

export function getCalendlyRedirectUri(origin: string) {
  const configuredRedirectUri = readOptionalEnv(process.env.CALENDLY_OAUTH_REDIRECT_URI);
  const redirectUri =
    configuredRedirectUri ?? new URL(CALENDLY_OAUTH_CALLBACK_PATH, origin).toString();

  try {
    const parsedRedirectUri = new URL(redirectUri);

    if (parsedRedirectUri.pathname !== CALENDLY_OAUTH_CALLBACK_PATH) {
      throw new Error(
        `Invalid CALENDLY_OAUTH_REDIRECT_URI. Expected callback path ${CALENDLY_OAUTH_CALLBACK_PATH}.`,
      );
    }

    if (parsedRedirectUri.search || parsedRedirectUri.hash) {
      throw new Error(
        "Invalid CALENDLY_OAUTH_REDIRECT_URI. Query params and hashes are not allowed.",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid CALENDLY")) {
      throw error;
    }

    throw new Error("Invalid CALENDLY_OAUTH_REDIRECT_URI. Expected an absolute URL.");
  }

  return redirectUri;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", getCalendlyServerEnv().stateSecret)
    .update(encodedPayload)
    .digest("base64url");
}

function signaturesMatch(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function isOauthStatePayload(value: unknown): value is CalendlyOauthStatePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<CalendlyOauthStatePayload>;

  return (
    payload.v === 1 &&
    typeof payload.uid === "string" &&
    payload.uid.length > 0 &&
    typeof payload.rdu === "string" &&
    payload.rdu.length > 0 &&
    typeof payload.nonce === "string" &&
    payload.nonce.length > 0 &&
    typeof payload.exp === "number"
  );
}

export function createCalendlyOauthState(userId: string, redirectUri: string) {
  const payload: CalendlyOauthStatePayload = {
    v: 1,
    uid: userId,
    rdu: redirectUri,
    nonce: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyCalendlyOauthState(state: string | null) {
  if (!state) {
    return null;
  }

  const [encodedPayload, signature, extra] = state.split(".");

  if (!encodedPayload || !signature || extra) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);

  if (!signaturesMatch(signature, expectedSignature)) {
    return null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return null;
  }

  if (!isOauthStatePayload(payload)) {
    return null;
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    userId: payload.uid,
    redirectUri: payload.rdu,
  };
}

export function buildCalendlyOauthUrl(options: {
  state: string;
  redirectUri: string;
}) {
  const { clientId, scopes } = getCalendlyServerEnv();
  const url = new URL(CALENDLY_AUTHORIZE_URL);

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", options.state);

  if (scopes) {
    url.searchParams.set("scope", scopes);
  }

  return url.toString();
}

function getTokenExpiresAt(expiresIn: number | undefined) {
  const seconds = Number.isFinite(expiresIn) && expiresIn ? expiresIn : 7200;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function readCalendlyJson(response: Response) {
  return (await response.json().catch(() => null)) as unknown;
}

function getCalendlyErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const errorPayload = payload as {
    error?: string;
    error_description?: string;
    message?: string;
    title?: string;
  };

  return (
    errorPayload.error_description ??
    errorPayload.message ??
    errorPayload.title ??
    errorPayload.error ??
    fallback
  );
}

function parseTokenPayload(payload: unknown): CalendlyTokenResponse {
  const tokenPayload = payload as RawCalendlyTokenResponse;

  if (!tokenPayload?.access_token || !tokenPayload.refresh_token) {
    throw new Error("Calendly did not return complete OAuth tokens.");
  }

  const expiresIn =
    typeof tokenPayload.expires_in === "number" ? tokenPayload.expires_in : null;

  return {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresAt: getTokenExpiresAt(expiresIn ?? undefined),
    expiresIn,
    tokenType: tokenPayload.token_type ?? null,
  };
}

async function postCalendlyTokenRequest(body: URLSearchParams, context: string) {
  const { clientId, clientSecret } = getCalendlyServerEnv();

  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const response = await fetch(CALENDLY_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
    cache: "no-store",
  });
  const payload = await readCalendlyJson(response);

  if (!response.ok) {
    throw new Error(getCalendlyErrorMessage(payload, context));
  }

  return parseTokenPayload(payload);
}

export async function exchangeCalendlyCodeForTokens(options: {
  code: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams();

  body.set("grant_type", "authorization_code");
  body.set("code", options.code);
  body.set("redirect_uri", options.redirectUri);

  return postCalendlyTokenRequest(body, "Calendly token exchange failed.");
}

export async function refreshCalendlyToken(refreshToken: string) {
  const body = new URLSearchParams();

  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);

  return postCalendlyTokenRequest(body, "Calendly token refresh failed.");
}

export function calendlyTokenNeedsRefresh(expiresAt: string | null | undefined) {
  if (!expiresAt) {
    return true;
  }

  return (
    new Date(expiresAt).getTime() <=
    Date.now() + TOKEN_REFRESH_SKEW_SECONDS * 1000
  );
}

async function getCalendlyApi<T>(path: string, accessToken: string) {
  const response = await fetch(new URL(path, CALENDLY_API_BASE_URL), {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    cache: "no-store",
  });
  const payload = await readCalendlyJson(response);

  if (!response.ok) {
    throw new Error(getCalendlyErrorMessage(payload, "Calendly API request failed."));
  }

  return payload as T;
}

async function postCalendlyApi<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(new URL(path, CALENDLY_API_BASE_URL), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await readCalendlyJson(response);

  if (!response.ok) {
    throw new Error(getCalendlyErrorMessage(payload, "Calendly API request failed."));
  }

  return payload as T;
}

export async function getCalendlyCurrentUser(accessToken: string) {
  const payload = await getCalendlyApi<RawCalendlyCurrentUserResponse>(
    "/users/me",
    accessToken,
  );
  const resource = payload.resource;

  if (!resource?.uri || !resource.current_organization) {
    throw new Error("Calendly did not return the connected user.");
  }

  return {
    uri: resource.uri,
    name: resource.name ?? null,
    email: resource.email ?? null,
    organizationUri: resource.current_organization,
  };
}

export async function listCalendlyEventTypes(options: {
  accessToken: string;
  userUri: string;
}) {
  const params = new URLSearchParams();

  params.set("user", options.userUri);

  const payload = await getCalendlyApi<RawCalendlyEventTypesResponse>(
    `/event_types?${params.toString()}`,
    options.accessToken,
  );

  return (payload.collection ?? [])
    .map((eventType) => ({
      uri: eventType.uri ?? "",
      name: eventType.name ?? "",
      active: Boolean(eventType.active),
      schedulingUrl: eventType.scheduling_url ?? null,
      duration: typeof eventType.duration === "number" ? eventType.duration : null,
    }))
    .filter((eventType) => eventType.uri && eventType.name);
}

export async function createCalendlySchedulingLink(options: {
  accessToken: string;
  eventTypeUri: string;
}) {
  const payload = await postCalendlyApi<RawCalendlySchedulingLinkResponse>(
    "/scheduling_links",
    options.accessToken,
    {
      max_event_count: 1,
      owner: options.eventTypeUri,
      owner_type: "EventType",
    },
  );
  const bookingUrl = payload.resource?.booking_url?.trim();

  if (!bookingUrl) {
    throw new Error("Calendly did not return a scheduling link.");
  }

  return {
    bookingUrl,
    owner: payload.resource?.owner ?? options.eventTypeUri,
    ownerType: payload.resource?.owner_type ?? "EventType",
  };
}
