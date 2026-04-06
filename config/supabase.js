const { createClient } = require('@supabase/supabase-js');

/**
 * Initialise a Supabase client using environment variables. The anonymous key
 * should be used for client‑side operations such as authentication and
 * reading data that is publicly accessible. If your server requires
 * elevated privileges (for example to insert or update protected rows), you
 * can provide a service key via SUPABASE_SERVICE_KEY. Do not expose the
 * service key in the browser.
 */
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || null;

const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseAnonKey,
  {
    // Note: we set `auth.persistSession` to false because server side
    // processes should not persist sessions between restarts. The web UI
    // manages its own sessions via express‑session.
    auth: {
      persistSession: false,
    },
  },
);

module.exports = { supabase };