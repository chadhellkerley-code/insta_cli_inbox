import {
  getMetaServerEnv,
  META_API_VERSION,
  META_LOGIN_SCOPES,
} from "@/lib/meta/config";

type MetaErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
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

export function buildMetaOauthUrl(state: string) {
  const { appId, redirectUri } = getMetaServerEnv();
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_LOGIN_SCOPES.join(","));
  url.searchParams.set("state", state);

  return url.toString();
}

async function readMetaResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | T
    | MetaErrorPayload
    | null;

  if (!response.ok) {
    const message =
      (payload as MetaErrorPayload | null)?.error?.message ??
      "Meta rejected the request.";
    throw new Error(message);
  }

  return payload as T;
}

export async function exchangeCodeForShortLivedToken(code: string) {
  const { appId, appSecret, redirectUri } = getMetaServerEnv();
  const formData = new URLSearchParams();
  formData.set("client_id", appId);
  formData.set("client_secret", appSecret);
  formData.set("grant_type", "authorization_code");
  formData.set("redirect_uri", redirectUri);
  formData.set("code", code);

  console.log("Token exchange request:", {
    endpoint: "https://api.instagram.com/oauth/access_token",
    appId: process.env.META_APP_ID,
    hasSecret: !!process.env.META_APP_SECRET,
    redirectUri: redirectUri,
    codeLength: code.length,
  });

  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
    cache: "no-store",
  });

  console.log("Token exchange response:", {
    status: response.status,
    body: await response.clone().text(),
  });

  return readMetaResponse<ShortLivedTokenResponse>(response);
}

export async function exchangeForLongLivedToken(shortLivedToken: string) {
  const { appSecret } = getMetaServerEnv();
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  console.log("Long lived token response:", {
    status: response.status,
    body: await response.clone().text(),
  });

  return readMetaResponse<LongLivedTokenResponse>(response);
}

export async function fetchInstagramProfile(accessToken: string) {
  const url = new URL(`https://graph.instagram.com/${META_API_VERSION}/me`);
  url.searchParams.set(
    "fields",
    "id,username,account_type,name,profile_picture_url",
  );
  url.searchParams.set("access_token", accessToken);

  console.log("Profile fetch request:", {
    url: url.toString(),
  });

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  console.log("Profile fetch response:", {
    status: response.status,
    body: await response.clone().text(),
  });

  const payload = await readMetaResponse<MetaProfileResponse>(response);
  const profile = Array.isArray(payload.data) ? payload.data[0] : payload;

  return {
    appScopedUserId: profile.id ?? null,
    instagramAccountId: profile.id ?? profile.user_id ?? null,
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
  const url = new URL(
    `https://graph.instagram.com/${META_API_VERSION}/${options.instagramAccountId}/messages`,
  );

  const message =
    options.messageType && options.mediaUrl
      ? {
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

  return readMetaResponse<{
    recipient_id?: string;
    message_id?: string;
  }>(response);
}
