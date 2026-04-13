export const META_API_VERSION = "v25.0";
export const META_OAUTH_FLOW = "instagram_api_with_instagram_login";
export const META_OAUTH_CALLBACK_PATH = "/auth/callback";
export const META_MEDIA_BUCKET = "instagram-media";
export const PROFESSIONAL_ACCOUNT_HELP_URL =
  "https://help.instagram.com/502981923235522";
export const META_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const META_SHORT_LIVED_TOKEN_URL =
  "https://api.instagram.com/oauth/access_token";
export const META_GRAPH_BASE_URL = `https://graph.instagram.com/${META_API_VERSION}`;
export const META_FACEBOOK_GRAPH_BASE_URL =
  `https://graph.facebook.com/${META_API_VERSION}`;

export type MetaCanonicalRedirectConfig = {
  redirectUri: string;
  callbackPath: string;
  origin: string;
};

function readEnv(value: string | undefined, missingMessage: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(missingMessage);
  }

  return trimmed;
}

export function getMetaCanonicalRedirectConfig(): MetaCanonicalRedirectConfig {
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

  return {
    redirectUri: rawRedirectUri,
    callbackPath: redirectUri.pathname,
    origin: redirectUri.origin,
  };
}

export function getMetaCanonicalRedirectUri() {
  return getMetaCanonicalRedirectConfig().redirectUri;
}

export function getMetaServerEnv() {
  const appId = readEnv(process.env.META_APP_ID, "Missing required env: META_APP_ID.");
  const { redirectUri } = getMetaCanonicalRedirectConfig();
  const publicAppId = process.env.NEXT_PUBLIC_META_APP_ID?.trim();

  if (publicAppId && publicAppId !== appId) {
    throw new Error(
      "Invalid Meta app configuration. META_APP_ID and NEXT_PUBLIC_META_APP_ID must match.",
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
  const redirectConfig = getMetaCanonicalRedirectConfig();

  return {
    flow: META_OAUTH_FLOW,
    authorizeUrl: META_AUTHORIZE_URL,
    shortLivedTokenUrl: META_SHORT_LIVED_TOKEN_URL,
    graphBaseUrl: META_GRAPH_BASE_URL,
    facebookGraphBaseUrl: META_FACEBOOK_GRAPH_BASE_URL,
    redirectUri: redirectConfig.redirectUri,
    callbackPath: redirectConfig.callbackPath,
    callbackOrigin: redirectConfig.origin,
    scopes: Array.from(META_LOGIN_SCOPES),
  };
}
