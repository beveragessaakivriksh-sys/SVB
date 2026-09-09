# SVB — Saaki Vriksh Beverages

Beverage distribution & inventory management app.

- **Frontend:** React + Vite, deployed on Vercel.
- **Backend:** Supabase (Postgres, Auth, Storage, Realtime, Edge Functions).

## Deploy in 3 steps

**1. Backend — Supabase**
- Create a project at [supabase.com](https://supabase.com).
- Open the SQL Editor, paste in the entire contents of
  [`supabase/schema.sql`](./supabase/schema.sql), and run it. This creates
  every table, policy, view, and trigger the app needs.
- From *Project Settings → API*, copy the **Project URL** and **anon public**
  key.

**2. Connect the frontend to it**
- Open `src/lib/supabaseClient.ts` and paste those two values into
  `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top of the file. That's the
  only code change required — everything else already talks to Supabase.

**3. Frontend — Vercel**
- Push this repo to GitHub/GitLab/Bitbucket and import it in
  [Vercel](https://vercel.com) (framework preset "Vite" is auto-detected;
  build command `npm run build`, output directory `dist` — `vercel.json`
  already handles SPA routing). Deploy.

That's the whole setup — no other configuration is required. See
`supabase/README.md` for details on what each part of the schema does, and
optional env-var-based configuration if you'd rather not paste keys directly
into the file (e.g. to use different Supabase projects per Vercel
environment).

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. (Make sure you've pasted your Supabase
URL/key into `src/lib/supabaseClient.ts` first, or set `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` in a `.env` file — see `.env.example`.)

## Test

```bash
npm test          # run once (CI-friendly)
npm run test:watch  # re-run on file changes while developing
```

Uses [Vitest](https://vitest.dev). Current tests cover the core billing math
in `src/lib/billUtils.js` (bottle/crate conversions, invoice totals, invoice
numbering, payment balance) — the calculations every bill and invoice number
in the app depends on. See `src/lib/__tests__/` for the test files; add more
there as you touch other logic.

## Build

```bash
npm run build
npm run preview   # preview the production build locally
```
