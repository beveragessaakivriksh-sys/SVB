// lib/supabaseClient.ts
// Ready-to-use Supabase browser client typed against the generated schema.
//
// ─────────────────────────────────────────────────────────────────────────
// SETUP (do this once, right after creating your Supabase project):
// Go to your Supabase project -> Project Settings -> API, then paste the
// "Project URL" and "anon public" key below. The anon key is safe to ship
// in client-side code — it only ever grants what your RLS policies allow.
// ─────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://byjluewjuzpbfhhxxycm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_2Tp2gvVa1qSq5zFWHIGo9Q_B1U9lpRc";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./supabaseTypes";

// Env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) are also supported
// and take priority if set — handy for Vercel deployments where you'd
// rather configure per-environment values than edit this file. For local
// projects, pasting directly above is the simplest path and needs nothing
// else configured.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || SUPABASE_URL;
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || SUPABASE_ANON_KEY;

if (supabaseUrl.includes("YOUR-PROJECT-REF") || supabaseAnonKey.includes("YOUR-ANON-PUBLIC-KEY")) {
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] Using placeholder credentials. Paste your project URL and anon key into src/lib/supabaseClient.ts (or set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)."
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export default supabase;
