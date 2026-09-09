// supabase/functions/print-webhook/index.ts
// Stub Supabase Edge Function (Deno) — entry point for server-side print/webhook jobs.
// Deploy with:  supabase functions deploy print-webhook
//
// Replace the body with real logic (e.g. generate an ESC/POS payload, call a
// printer service, or persist a webhook event into public.bills).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req: Request) => {
  try {
    const body = await req.json().catch(() => ({}));
    const event = body?.event ?? "unknown";

    // Service-role client (bypasses RLS) — use only for trusted server work.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Example: log the webhook event. Replace with real handling.
    console.log("[print-webhook] event:", event, "payload:", body);

    return new Response(
      JSON.stringify({ ok: true, event }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});