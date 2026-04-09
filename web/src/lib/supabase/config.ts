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

export function getSupabasePublicEnv() {
  const supabaseUrl = readEnv(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "Missing required Supabase env: NEXT_PUBLIC_SUPABASE_URL.",
  );
  const supabaseAnonKey = readEnv(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "Missing required Supabase env: NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  );

  try {
    new URL(supabaseUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
  };
}
