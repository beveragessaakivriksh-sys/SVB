// supabase/functions/predict-demand/index.ts
// Supabase Edge Function (Deno) — generates an LLM-written narrative demand
// forecast from the same aggregated data the frontend's deterministic
// summary is built from (see src/pages/DataAnalytics.jsx).
//
// Deploy with:
//   supabase functions deploy predict-demand
//
// Requires one secret (a Gemini API key from https://aistudio.google.com/apikey):
//   supabase secrets set GEMINI_API_KEY=AIza...
//
// The frontend calls this with:
//   supabase.functions.invoke("predict-demand", { body: summary })
// and falls back to showing only the deterministic summary if this function
// isn't deployed yet, has no API key configured, or the call fails for any
// reason — the AI narrative is a nice-to-have layered on top, never a
// blocker for the page.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Change this if Google renames/deprecates the model — everything else in
// this function (prompt, request/response shape) stays the same.
const GEMINI_MODEL = "gemini-2.5-flash";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY is not set. Run: supabase secrets set GEMINI_API_KEY=AIza..." }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const summary = await req.json().catch(() => ({}));

    const prompt = `You are a supply-chain analyst for a beverage distribution business (Saaki Vriksh Beverages).
Given this JSON of recent delivery, production, and crate-return data, write a short (120-180 words),
plain-language narrative for a busy operations manager: 2-3 sentences on overall demand trend, which
flavours/categories are rising or falling, any operational risk worth flagging (e.g. high damaged-bottle
or unreturned-crate counts), and one concrete recommendation for the next 7 days. No headers, no bullet
points, no markdown — just a short paragraph or two of plain text.

Data:
${JSON.stringify(summary)}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 400 },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `LLM API error (${res.status}): ${errText.slice(0, 300)}` }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    const narrative = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((part: any) => part?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();

    return new Response(JSON.stringify({ narrative: narrative || "No narrative returned." }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});

