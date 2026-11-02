import { createClient } from "@supabase/supabase-js";

// Browser-safe project identifiers. Access is still enforced by Supabase Auth
// and row-level security; this is not a privileged server credential.
const supabaseUrl =
  import.meta.env?.VITE_SUPABASE_URL ||
  "https://abnfffkmxqixrwzackjf.supabase.co";
const supabasePublishableKey =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
