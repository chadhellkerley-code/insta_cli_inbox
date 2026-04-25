import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ProfilePayload = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  last_login_at: string;
};

function getStringMetadata(user: User, key: string) {
  const value = user.user_metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildProfilePayload(user: User): ProfilePayload {
  return {
    id: user.id,
    email: user.email ?? null,
    full_name:
      getStringMetadata(user, "full_name") ??
      getStringMetadata(user, "name") ??
      user.email?.split("@")[0] ??
      null,
    avatar_url:
      getStringMetadata(user, "avatar_url") ??
      getStringMetadata(user, "picture"),
    last_login_at: new Date().toISOString(),
  };
}

async function upsertProfile(user: User) {
  const payload = buildProfilePayload(user);

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("profiles")
      .upsert(payload, { onConflict: "id" });

    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn("[supabase-auth] admin profile upsert failed, using user session", error);

    const supabase = createClient();
    const { error: sessionError } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });

    if (sessionError) {
      console.error("[supabase-auth] profile upsert failed", sessionError);
    }
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next") || "/dashboard";
  const next =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=No se pudo completar el acceso con Google.", request.url),
    );
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url),
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await upsertProfile(user);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
