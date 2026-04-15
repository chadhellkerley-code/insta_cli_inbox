function readEnv(
  value: string | undefined,
  missingMessage: string,
) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(missingMessage);
  }

  return trimmed;
}

function readSupabaseUrlEnv() {
  return readEnv(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    "Missing required Supabase env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.",
  );
}

function readSupabaseAnonKeyEnv() {
  return readEnv(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY,
    "Missing required Supabase env: NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY.",
  );
}

export function getSupabasePublicEnv() {
  const supabaseUrl = readSupabaseUrlEnv();
  const supabaseAnonKey = readSupabaseAnonKeyEnv();

  try {
    new URL(supabaseUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL must be a valid URL.");
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
  };
}
