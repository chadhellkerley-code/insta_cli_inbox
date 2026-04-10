import { GET as handleMetaOauthCallback } from "@/app/api/meta/oauth/callback/route";

export async function GET(request: Request) {
  return handleMetaOauthCallback(request);
}
