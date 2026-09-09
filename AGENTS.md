# AGENTS.md

## Project Context

This is a standalone React (Vite) + Supabase application. Treat it as
user-owned application code, keep changes focused on the user's request, and
preserve existing project conventions.

Start with `README.md` for local setup and environment variables, and
`supabase/README.md` for the backend schema and auth setup.

## Key Files

- `src/`: frontend application source.
- `src/api/db.js`: Supabase-backed data client (auth + entity CRUD) used
  throughout the app.
- `src/lib/supabaseClient.ts`: the underlying `@supabase/supabase-js` client.
- `supabase/migrations/`: SQL schema, RLS policies, and views.
- `vite.config.js`: Vite config.
- `vercel.json`: SPA rewrite rules for Vercel.
- `.env`: local-only environment values; never commit secrets.

## Working Notes

- Run `npm run dev` for local frontend development against your configured
  Supabase project (see `.env`).
- Run the relevant checks from `package.json` (`npm run lint`, `npm run
  typecheck`) before finishing code changes.
