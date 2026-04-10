export const META_API_VERSION = "v25.0";
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
  return {
    appId: readEnv(process.env.META_APP_ID, "Missing required env: META_APP_ID."),
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
  return {
    appId: readEnv(
      process.env.NEXT_PUBLIC_META_APP_ID,
      "Missing required env: NEXT_PUBLIC_META_APP_ID.",
    ),
  };
}

export const META_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
  "instagram_business_content_publish",
] as const;

export function normalizeAccountType(accountType: string | null | undefined) {
  return (accountType ?? "").trim().toUpperCase();
}

export function isProfessionalAccountType(accountType: string | null | undefined) {
  const normalized = normalizeAccountType(accountType);
  return normalized === "BUSINESS" || normalized === "MEDIA_CREATOR";
}
