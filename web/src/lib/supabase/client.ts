import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv } from "@/lib/supabase/config";

let browserClient: SupabaseClient | undefined;

export function createClient() {
  if (!browserClient) {
    const { supabaseUrl, supabaseAnonKey } = getSupabasePublicEnv();

    browserClient = createBrowserClient(
      supabaseUrl,
      supabaseAnonKey,
    );
  }

  return browserClient;
}
