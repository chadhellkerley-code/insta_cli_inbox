export const SHORT_LIVED_FALLBACK_MS = 60 * 60 * 1000;

export type ManagedInstagramToken = {
  accessToken: string;
  expiresIn: number;
  expiresAt: string;
  obtainedAt: string;
  lifecycle: "oauth";
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
  const expiresIn = shortLivedToken.expires_in ?? SHORT_LIVED_FALLBACK_MS / 1000;

  return {
    accessToken: shortLivedToken.access_token,
    expiresIn,
    expiresAt: buildExpiresAt(expiresIn),
    obtainedAt: new Date().toISOString(),
    lifecycle: "oauth",
  } satisfies ManagedInstagramToken;
}

export async function ensureInstagramAccessToken(options: {
  accessToken: string;
  expiresAt: string | null;
}) {
  const timeRemainingMs = getTokenTimeRemaining(options.expiresAt);

  if (timeRemainingMs === null || timeRemainingMs > 0) {
    return {
      accessToken: options.accessToken,
      expiresIn: SHORT_LIVED_FALLBACK_MS / 1000,
      expiresAt: options.expiresAt ?? buildExpiresAt(SHORT_LIVED_FALLBACK_MS / 1000),
      obtainedAt: new Date().toISOString(),
      lifecycle: "oauth",
    } satisfies ManagedInstagramToken;
  }

  throw new Error(
    "El token de Instagram vencio. Vuelve a conectar la cuenta para seguir enviando mensajes.",
  );
}
