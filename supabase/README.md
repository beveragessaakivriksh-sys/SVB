# SVB — Supabase backend

This folder is the Supabase backend for SVB (Saaki Vriksh Beverages). The
frontend reads/writes these tables through the `@supabase/supabase-js` client
in `src/lib/supabaseClient.ts` (wrapped by `src/api/db.js`).

## 1. Create the project
- Create a Supabase project (region `ap-south-1` recommended). Note the **Project URL** and **anon key** from *Project Settings → API*.

## 2. Run the schema
Open the Supabase **SQL Editor**, paste the entire contents of
[`supabase/schema.sql`](./schema.sql), and run it. That one file creates
everything: profiles, customers, products, invoice_series (+ default
GST/non-GST series and pending-bills view), bills, deliveries, crate_entries,
daily_productions, orders, daily_summaries, live_locations, location_history,
the unified stock ledger, RLS policies (including admin write access for live
tracking and shared-row update/delete access), reporting views, and realtime.
It's safe to re-run — every statement uses `if not exists` / `or replace` /
a preceding `drop ... if exists` guard.

(The same SQL also exists split into individual files under
`supabase/migrations/`, in the order they're concatenated into `schema.sql`,
if you'd rather use the Supabase CLI: `supabase link --project-ref <ref>` then
`supabase db push`.)

## 3. Connect the frontend
Open `src/lib/supabaseClient.ts` and paste your **Project URL** and **anon
key** into the two constants at the top of the file:
```ts
const SUPABASE_URL = "https://<your-project>.supabase.co";
const SUPABASE_ANON_KEY = "<your-anon-key>";
```
That's it — no `.env` file is required to run locally. (If you'd rather use
environment variables instead — e.g. to keep different values per Vercel
environment — set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` and they'll
automatically take priority over the pasted values; see `.env.example`.)

## 4. Auth & roles
- Users sign up via Supabase Auth (email + password — no restrictions). A `profiles` row is created automatically.
- The account type chosen at signup (`user` or `admin`) is stored in signup metadata and applied immediately — **no approval by an existing admin is needed**.
- Change your own role at any time:
  ```sql
  select public.set_my_role('admin');   -- or 'user'
  ```

## 5. What lives where
| Feature | Table(s) |
| --- | --- |
| Customers, GST, per-product pricing, manual closing stock | `customers` |
| Dynamic product catalogue | `products` |
| Invoice numbering series | `invoice_series` |
| Bills / invoices (GST + non-GST) | `bills` |
| Deliveries | `deliveries` |
| Crate returns (manual + auto from bills) | `crate_entries` (`source` = `manual` \| `bill`, `bill_id` links back) |
| Daily production & factory closing stock | `daily_productions` |
| Internal orders (Incoming Orders) | `orders` |
| Per-user daily route summary | `daily_summaries` |
| Live + breadcrumb location tracking | `live_locations`, `location_history` |

## 6. Closing stock (unified ledger, 006)
`customers.closing_stock_crates/loose` is the manual **opening** stock. The
live closing stock (`hotel_closing_stock` view) is:
`opening + Σ bills.items (bottles delivered, from the JSONB item list) − Σ (crate_returns×24 + loose + damaged from crate_entries)`.
Bills are the single source of truth for what was delivered and
`crate_entries` for what was returned, so the same number is identical across
Customers, Crates Entries, Bill Entries, and the thermal print's "Previous
Closing Stock" / "Closing Stock (Hotel)" lines.

## 7. Location tracking
- 15-minute breadcrumb → `location_history` (low-power lock first, 15s timeout).
- Admin "High-freq live" → `live_locations.is_live_active` flips the user's
  `watchPosition` into high-accuracy mode. This requires an **admin write**
  RLS policy on `live_locations` (`007_live_locations_admin_write.sql`) —
  without it, the toggle updates 0 rows and nothing happens, since the base
  policy only lets a user write their own row.
- All writes are RLS-guarded by `auth.uid() = user_id`; failures fall back to an
  IndexedDB queue and are retried when back online.
- The map (`src/pages/LocationTracking.jsx`) is built on `react-leaflet` +
  `leaflet` — make sure `npm install` has picked up `leaflet` as a dependency
  (`package.json`), or the Live Tracking / Historical Trail maps won't render.
- `001_location_schema.sql` also drops two legacy policies from an earlier
  version of this file (`"profiles self read"` / `"profiles admin read"`)
  that queried `public.profiles` from within a policy ON `public.profiles`
  itself — Postgres rejects that with `infinite recursion detected in policy
  for relation "profiles"` (42P17), which breaks every profile read (i.e.
  every `db.auth.me()` call, i.e. the whole app). All admin checks in this
  schema now go through the single non-recursive `public.is_admin()` helper.

## 8. Reporting views (003)
- `v_crate_entries_report` — one row per crate entry (manual + bill), newest
  first; backs the Crates Entries date-range PDF export and the
  day's-entries section included on the closing-stock PDF.
- `v_order_flavour_summary` — crates & loose bottles per order item; mirrors
  the Orders checkbox summary (crates + loose per flavour per hotel).

## 9. Invoice series & pending bills (005)
- One active series per bill type (`gst` / `non_gst`), enforced by a unique
  constraint; default fallback series (`INV-1001`, `NG-1001`) are inserted
  automatically if none exist.
- `next_invoice_number(type)` is an atomic counter RPC available if you want
  server-side invoice numbering; the current frontend (`src/lib/invoiceSeries.js`)
  generates numbers by reading and incrementing `invoice_series` directly via
  `db.entities.InvoiceSeries`, which this schema fully supports as-is.
- `v_customer_pending_bills` backs the Bill Entries pending-bills warning banner.

## 10. bills.customer_name (008)
`bills` was missing the denormalized `customer_name` column that
`deliveries` and `crate_entries` already had — the app writes it on every
bill (e.g. Orders → "Mark Dispatched" for non-GST orders), so without it
PostgREST rejected the insert with `Could not find the 'customer_name'
column of 'bills' in the schema cache`. Added, with a best-effort backfill
for any bills created before this migration ran.

## 11. Shared-row update/delete (009)
Every `*_select` policy on customers/products/invoice_series/bills/
deliveries/crate_entries/daily_productions/orders already allowed
`user_id is null` (rows nobody "owns" are visible to any signed-in user),
but the matching `*_update`/`*_delete` policies never got the same
allowance. Since the frontend never actually sets `user_id` when creating
any of these rows, every one of them has `user_id = null` — so no
non-admin user could ever update or delete a bill, delivery, order, crate
entry, etc. This showed up as "Save Entries" / "Mark Delivered" in Bill
Entries silently doing nothing for non-admin accounts. Fixed by bringing
`*_update`/`*_delete` in line with their `*_select` sibling on every
affected table.

## 12. Data Analytics "Predict Demand"
The original build called a hosted serverless function
(`db.functions.invoke("predictDemand", ...)`) that has no Supabase
equivalent — this `db` client only implements auth + entity CRUD, so the
button always threw and showed "Prediction failed: ...".

Two things now happen when you click it, layered on top of each other:
- **Demand Summary** — a real, working, deterministic summary computed
  client-side from the same flavour/weekly/hotel forecasts already shown on
  the page. Needs no setup, always works.
- **AI Narrative** — an LLM-written paragraph from the same data, via the
  `predict-demand` Supabase Edge Function
  (`supabase/functions/predict-demand/index.ts`), which calls Google's
  Gemini API. This is optional — if it's not deployed or configured yet,
  the page shows a small note instead of breaking.

To enable the AI narrative:
```bash
supabase functions deploy predict-demand
supabase secrets set GEMINI_API_KEY=AIza...   # from aistudio.google.com/apikey
```
That's it — no frontend changes needed. To use a different LLM provider
instead, edit the `fetch(...)` call inside `predict-demand/index.ts`; the
rest of the function (CORS, error handling, response shape) stays the same.
