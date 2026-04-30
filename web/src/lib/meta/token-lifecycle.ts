import {
  exchangeInstagramTokenForLongLivedToken,
  refreshInstagramLongLivedAccessToken,
} from "@/lib/meta/client";

export const SHORT_LIVED_FALLBACK_MS = 60 * 60 * 1000;
const LONG_LIVED_FALLBACK_SECONDS = 60 * 24 * 60 * 60;
const TOKEN_REFRESH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export type ManagedInstagramToken = {
  accessToken: string;
  expiresIn: number;
  expiresAt: string;
  obtainedAt: string;
  lifecycle: "oauth_short_lived" | "oauth_long_lived";
};

function buildExpiresAt(expiresInSeconds: number) {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

export function getTokenTimeRemaining(expiresAt: string | null | undefined) {
  if (!expiresAt) {
    return null;
  }

  const expiresAtMs = new Date(expiresAt).getTime();

  if (Number.isNaN(expiresAtMs)) {
    return null;
  }

  return expiresAtMs - Date.now();
}

export async function resolveInitialInstagramToken(shortLivedToken: {
  access_token: string;
  expires_in?: number;
}) {
  const fallbackShortLivedExpiresIn =
    shortLivedToken.expires_in ?? SHORT_LIVED_FALLBACK_MS / 1000;
  const nowIso = new Date().toISOString();

  try {
    const longLivedToken = await exchangeInstagramTokenForLongLivedToken({
      shortLivedAccessToken: shortLivedToken.access_token,
    });
    const expiresIn = longLivedToken.expiresIn ?? LONG_LIVED_FALLBACK_SECONDS;

    return {
      accessToken: longLivedToken.accessToken,
      expiresIn,
      expiresAt: buildExpiresAt(expiresIn),
      obtainedAt: nowIso,
      lifecycle: "oauth_long_lived",
    } satisfies ManagedInstagramToken;
  } catch (error) {
    console.warn("[meta-token] long-lived exchange failed, falling back to short-lived token", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    accessToken: shortLivedToken.access_token,
    expiresIn: fallbackShortLivedExpiresIn,
    expiresAt: buildExpiresAt(fallbackShortLivedExpiresIn),
    obtainedAt: nowIso,
    lifecycle: "oauth_short_lived",
  } satisfies ManagedInstagramToken;
}

export async function ensureInstagramAccessToken(options: {
  accessToken: string;
  expiresAt: string | null;
  lifecycle?: string | null;
  onTokenUpdate?: (token: ManagedInstagramToken) => Promise<void>;
}) {
  const timeRemainingMs = getTokenTimeRemaining(options.expiresAt);
  const lifecycle = options.lifecycle ?? "oauth_short_lived";
  const isLegacyOauthLifecycle = lifecycle === "oauth";
  const isLongLivedLifecycle = lifecycle === "oauth_long_lived";
  const shouldUpgradeLegacyOauth = isLegacyOauthLifecycle && (timeRemainingMs ?? 1) > 0;

  if (shouldUpgradeLegacyOauth) {
    try {
      const longLived = await exchangeInstagramTokenForLongLivedToken({
        shortLivedAccessToken: options.accessToken,
      });
      const expiresIn = longLived.expiresIn ?? LONG_LIVED_FALLBACK_SECONDS;
      const nextToken = {
        accessToken: longLived.accessToken,
        expiresIn,
        expiresAt: buildExpiresAt(expiresIn),
        obtainedAt: new Date().toISOString(),
        lifecycle: "oauth_long_lived",
      } satisfies ManagedInstagramToken;

      if (options.onTokenUpdate) {
        await options.onTokenUpdate(nextToken);
      }

      return nextToken;
    } catch (error) {
      console.warn("[meta-token] legacy oauth token upgrade failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const shouldRefreshLongLivedToken =
    isLongLivedLifecycle &&
    (timeRemainingMs === null || timeRemainingMs <= TOKEN_REFRESH_WINDOW_MS);

  if (shouldRefreshLongLivedToken) {
    const refreshed = await refreshInstagramLongLivedAccessToken({
      accessToken: options.accessToken,
    });
    const expiresIn = refreshed.expiresIn ?? LONG_LIVED_FALLBACK_SECONDS;
    const nextToken = {
      accessToken: refreshed.accessToken,
      expiresIn,
      expiresAt: buildExpiresAt(expiresIn),
      obtainedAt: new Date().toISOString(),
      lifecycle: "oauth_long_lived",
    } satisfies ManagedInstagramToken;

    if (options.onTokenUpdate) {
      await options.onTokenUpdate(nextToken);
    }

    return nextToken;
  }

  if (timeRemainingMs === null || timeRemainingMs > 0) {
    return {
      accessToken: options.accessToken,
      expiresIn: SHORT_LIVED_FALLBACK_MS / 1000,
      expiresAt: options.expiresAt ?? buildExpiresAt(SHORT_LIVED_FALLBACK_MS / 1000),
      obtainedAt: new Date().toISOString(),
      lifecycle: isLongLivedLifecycle ? "oauth_long_lived" : "oauth_short_lived",
    } satisfies ManagedInstagramToken;
  }

  throw new Error(
    isLongLivedLifecycle
      ? "No pudimos renovar el token de Instagram. Vuelve a conectar la cuenta para seguir enviando mensajes."
      : "El token de Instagram vencio. Vuelve a conectar la cuenta para seguir enviando mensajes.",
  );
}
