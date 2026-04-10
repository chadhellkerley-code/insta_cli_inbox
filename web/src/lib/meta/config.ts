export const META_API_VERSION = "v25.0";
export const EXPECTED_META_APP_ID = "951837267330748";
export const META_OAUTH_REDIRECT_URI =
  "https://insta-cli-inbox.vercel.app/auth/callback";
export const META_OAUTH_STATE_COOKIE = "meta_instagram_oauth_state";
export const META_MEDIA_BUCKET = "instagram-media";
export const PROFESSIONAL_ACCOUNT_HELP_URL =
  "https://help.instagram.com/502981923235522";

function readEnv(value: string | undefined, missingMessage: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(missingMessage);
  }

  return trimmed;
}

export function getMetaServerEnv() {
  const appId = readEnv(process.env.META_APP_ID, "Missing required env: META_APP_ID.");
  const redirectUri =
    process.env.META_OAUTH_REDIRECT_URI?.trim() || META_OAUTH_REDIRECT_URI;

  if (appId !== EXPECTED_META_APP_ID) {
    throw new Error(
      `Invalid META_APP_ID. Expected ${EXPECTED_META_APP_ID} for Meta OAuth.`,
    );
  }

  if (redirectUri !== META_OAUTH_REDIRECT_URI) {
    throw new Error(
      `Invalid META_OAUTH_REDIRECT_URI. Expected ${META_OAUTH_REDIRECT_URI} for Meta OAuth.`,
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
  "instagram_manage_comments",
] as const;

export function normalizeAccountType(accountType: string | null | undefined) {
  return (accountType ?? "").trim().toUpperCase();
}

export function isProfessionalAccountType(accountType: string | null | undefined) {
  const normalized = normalizeAccountType(accountType);
  return normalized === "BUSINESS" || normalized === "MEDIA_CREATOR";
}
