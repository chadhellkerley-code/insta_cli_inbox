export const META_API_VERSION = "v25.0";
export const META_OAUTH_FLOW = "instagram_api_with_instagram_login";
export const EXPECTED_META_APP_ID = "951837267330748";
export const META_OAUTH_CALLBACK_PATH = "/auth/callback";
export const META_MEDIA_BUCKET = "instagram-media";
export const PROFESSIONAL_ACCOUNT_HELP_URL =
  "https://help.instagram.com/502981923235522";
export const META_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const META_SHORT_LIVED_TOKEN_URL =
  "https://api.instagram.com/oauth/access_token";
export const META_LONG_LIVED_TOKEN_URL =
  "https://graph.instagram.com/access_token";
export const META_REFRESH_TOKEN_URL =
  "https://graph.instagram.com/refresh_access_token";
export const META_GRAPH_BASE_URL = `https://graph.instagram.com/${META_API_VERSION}`;

function readEnv(value: string | undefined, missingMessage: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(missingMessage);
  }

  return trimmed;
}

export function getMetaCanonicalRedirectUri() {
  const rawRedirectUri = readEnv(
    process.env.META_OAUTH_REDIRECT_URI,
    "Missing required env: META_OAUTH_REDIRECT_URI.",
  );

  let redirectUri: URL;

  try {
    redirectUri = new URL(rawRedirectUri);
  } catch {
    throw new Error(
      "Invalid META_OAUTH_REDIRECT_URI. Expected an absolute URL for Meta OAuth.",
    );
  }

  if (redirectUri.pathname !== META_OAUTH_CALLBACK_PATH) {
    throw new Error(
      `Invalid META_OAUTH_REDIRECT_URI. Expected callback path ${META_OAUTH_CALLBACK_PATH}.`,
    );
  }

  if (redirectUri.search || redirectUri.hash) {
    throw new Error(
      "Invalid META_OAUTH_REDIRECT_URI. Query params and hashes are not allowed.",
    );
  }

  return redirectUri.toString();
}

export function getMetaServerEnv() {
  const appId = readEnv(process.env.META_APP_ID, "Missing required env: META_APP_ID.");
  const redirectUri = getMetaCanonicalRedirectUri();

  if (appId !== EXPECTED_META_APP_ID) {
    throw new Error(
      `Invalid META_APP_ID. Expected ${EXPECTED_META_APP_ID} for Meta OAuth.`,
    );
  }

  return {
    appId,
    redirectUri,
    appSecret: readEnv(
      process.env.META_APP_SECRET,
      "Missing required env: META_APP_SECRET.",
    ),
    webhookVerifyToken: readEnv(
      process.env.META_WEBHOOK_VERIFY_TOKEN,
      "Missing required env: META_WEBHOOK_VERIFY_TOKEN.",
    ),
  };
}

export function getMetaPublicEnv() {
  const appId = readEnv(
    process.env.NEXT_PUBLIC_META_APP_ID,
    "Missing required env: NEXT_PUBLIC_META_APP_ID.",
  );

  if (appId !== EXPECTED_META_APP_ID) {
    throw new Error(
      `Invalid NEXT_PUBLIC_META_APP_ID. Expected ${EXPECTED_META_APP_ID} for Meta OAuth.`,
    );
  }

  return {
    appId,
  };
}

export const META_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
] as const;

export function getMetaOauthConfig() {
  return {
    flow: META_OAUTH_FLOW,
    authorizeUrl: META_AUTHORIZE_URL,
    shortLivedTokenUrl: META_SHORT_LIVED_TOKEN_URL,
    longLivedTokenUrl: META_LONG_LIVED_TOKEN_URL,
    refreshTokenUrl: META_REFRESH_TOKEN_URL,
    graphBaseUrl: META_GRAPH_BASE_URL,
    redirectUri: getMetaCanonicalRedirectUri(),
    scopes: Array.from(META_LOGIN_SCOPES),
  };
}

export function normalizeAccountType(accountType: string | null | undefined) {
  return (accountType ?? "").trim().toUpperCase();
}

export function isProfessionalAccountType(accountType: string | null | undefined) {
  const normalized = normalizeAccountType(accountType);
  return normalized === "BUSINESS" || normalized === "MEDIA_CREATOR";
}
