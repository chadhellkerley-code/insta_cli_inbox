import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv } from "@/lib/supabase/config";

let adminClient: ReturnType<typeof createClient> | undefined;

export function createAdminClient() {
  const { supabaseUrl } = getSupabasePublicEnv();
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!serviceRoleKey) {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY === undefined) {
      console.error("SUPABASE_SERVICE_ROLE_KEY runtime value:", process.env.SUPABASE_SERVICE_ROLE_KEY);
    }

    throw new Error(
      "Supabase admin client no disponible.",
    );
  }

  if (!adminClient) {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return adminClient;
}
