const envAliases = {
  NEXT_PUBLIC_SUPABASE_URL: [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_URL",
  ] as const,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: [
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY",
  ] as const,
};

function readEnv(name: keyof typeof envAliases) {
  const value = envAliases[name]
    .map((envName) => process.env[envName]?.trim())
    .find(Boolean);

  if (!value) {
    throw new Error(
      `Missing required Supabase env: ${envAliases[name].join(" or ")}.`,
    );
  }

  return value;
}

export function getSupabasePublicEnv() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

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
