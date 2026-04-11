import { handleCanonicalMetaOauthCallback } from "@/lib/meta/oauth-callback";

export async function GET(request: Request) {
  return handleCanonicalMetaOauthCallback(request);
}
