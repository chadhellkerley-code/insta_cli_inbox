import {
  exchangeForLongLivedToken,
  refreshLongLivedInstagramToken,
} from "@/lib/meta/client";

export const SHORT_LIVED_THRESHOLD_MS = 2 * 60 * 60 * 1000;
export const LONG_LIVED_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
export const SHORT_LIVED_FALLBACK_MS = 60 * 60 * 1000;
export const LONG_LIVED_FALLBACK_MS = 60 * 24 * 60 * 60 * 1000;

export type ManagedInstagramToken = {
  accessToken: string;
  expiresAt: string;
  lifecycle: "short-lived" | "long-lived";
};

function buildExpiresAt(expiresInSeconds: number) {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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

export function isUnsupportedLongLivedLifecycleError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("long-lived token exchange failed") ||
    message.includes("long-lived token refresh failed") ||
    message.includes("unsupported request - method type: get") ||
    message.includes("unsupported request")
  );
}

export async function resolveInitialInstagramToken(shortLivedToken: {
  access_token: string;
  expires_in?: number;
}) {
  try {
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken.access_token);

    return {
      accessToken: longLivedToken.access_token,
      expiresAt: buildExpiresAt(longLivedToken.expires_in ?? LONG_LIVED_FALLBACK_MS / 1000),
      lifecycle: "long-lived",
    } satisfies ManagedInstagramToken;
  } catch (error) {
    if (!isUnsupportedLongLivedLifecycleError(error)) {
      throw error;
    }

    return {
      accessToken: shortLivedToken.access_token,
      expiresAt: buildExpiresAt(shortLivedToken.expires_in ?? SHORT_LIVED_FALLBACK_MS / 1000),
      lifecycle: "short-lived",
    } satisfies ManagedInstagramToken;
  }
}

export async function ensureInstagramAccessToken(options: {
  accessToken: string;
  expiresAt: string | null;
  persistToken: (token: ManagedInstagramToken) => Promise<void>;
}) {
  const timeRemainingMs = getTokenTimeRemaining(options.expiresAt);

  if (timeRemainingMs === null || timeRemainingMs > LONG_LIVED_REFRESH_THRESHOLD_MS) {
    return {
      accessToken: options.accessToken,
      expiresAt: options.expiresAt ?? buildExpiresAt(LONG_LIVED_FALLBACK_MS / 1000),
      lifecycle: "long-lived",
    } satisfies ManagedInstagramToken;
  }

  const shouldAttemptLongLivedExchange = timeRemainingMs <= SHORT_LIVED_THRESHOLD_MS;

  try {
    if (shouldAttemptLongLivedExchange) {
      const upgradedToken = await resolveInitialInstagramToken({
        access_token: options.accessToken,
        expires_in: Math.max(1, Math.ceil(timeRemainingMs / 1000)),
      });

      if (
        upgradedToken.lifecycle === "long-lived" ||
        upgradedToken.expiresAt !== options.expiresAt
      ) {
        await options.persistToken(upgradedToken);
      }

      return upgradedToken;
    }

    const refreshedToken = await refreshLongLivedInstagramToken(options.accessToken);
    const managedToken: ManagedInstagramToken = {
      accessToken: refreshedToken.access_token,
      expiresAt: buildExpiresAt(refreshedToken.expires_in ?? LONG_LIVED_FALLBACK_MS / 1000),
      lifecycle: "long-lived",
    };

    await options.persistToken(managedToken);
    return managedToken;
  } catch (error) {
    if (timeRemainingMs > 0) {
      return {
        accessToken: options.accessToken,
        expiresAt: options.expiresAt ?? buildExpiresAt(LONG_LIVED_FALLBACK_MS / 1000),
        lifecycle: "long-lived",
      } satisfies ManagedInstagramToken;
    }

    if (isUnsupportedLongLivedLifecycleError(error)) {
      throw new Error(
        "Meta no permite renovar automaticamente este token para la cuenta actual. Vuelve a conectar la cuenta para seguir enviando mensajes.",
      );
    }

    throw error;
  }
}
