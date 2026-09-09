-- =====================================================================
-- SVB — Unified stock ledger (bills as source of truth)
-- File: supabase/migrations/006_unified_stock_from_bills.sql
-- Additive to 001–005.
--
-- BREAKING CHANGE to hotel_closing_stock view:
--   Delivered bottles are now computed from bills.items (JSONB) instead
--   of deliveries.total_bottles.  This makes the closing stock identical
--   across Customers, Crates Entries, Bill Entries and the thermal print,
--   because the Bill entity is the single source of truth for what was
--   delivered (items array) and the CrateEntry is the single source of
--   truth for what was returned (synced from bills + manual entries).
--
--   Previous Closing Stock (thermal) = stock excluding this bill.
--   Closing Stock (Hotel) (thermal)   = stock including this bill.
--   Both are derived from the same ledger, so the number printed on the
--   bill matches what every tab shows.
-- =====================================================================

-- ------------------------------------------------------------------
-- hotel_closing_stock (replaced)
--   Opening (manual customer closing stock)
--   + delivered bottles (summed from every bill's items JSONB,
--     24 bottles/crate for Goli Fizz/Blast, 30 for Petbottle)
--   - returned bottles (crates_returned*24 + loose_returned + damaged,
--     from crate_entries — both manual and bill-synced)
--   Per customer.
-- ------------------------------------------------------------------
-- CREATE OR REPLACE VIEW cannot change an existing view's column types
-- (Postgres error 42P16: "cannot change data type of view column").
-- A prior run of this migration (or of 002_stock_sync_and_realtime.sql,
-- which originally defined hotel_closing_stock) may have left
-- closing_bottles as bigint; this version computes it as numeric. Drop
-- first so the CREATE below always succeeds, on a fresh project or a
-- re-run alike.
DROP VIEW IF EXISTS public.hotel_closing_stock;

CREATE OR REPLACE VIEW public.hotel_closing_stock AS
WITH delivered AS (
  SELECT b.customer_id,
    COALESCE(SUM(
      COALESCE((it->>'crates')::numeric, 0) *
        CASE WHEN it->>'category' = 'Petbottle' THEN 30 ELSE 24 END
      + COALESCE((it->>'loose')::numeric, 0)
    ), 0) AS bottles
  FROM public.bills b,
    jsonb_array_elements(COALESCE(b.items, '[]'::jsonb)) AS it
  GROUP BY b.customer_id
),
returns AS (
  SELECT customer_id,
    COALESCE(SUM(crates_returned), 0) * 24
    + COALESCE(SUM(loose_bottles_returned), 0)
    + COALESCE(SUM(damaged_bottles), 0) AS returned_bottles
  FROM public.crate_entries
  GROUP BY customer_id
)
SELECT
  c.id AS customer_id,
  c.customer_name,
  c.display_name,
  (COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
    + COALESCE(d.bottles, 0)
    - COALESCE(r.returned_bottles, 0)) AS closing_bottles,
  FLOOR((COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
    + COALESCE(d.bottles, 0) - COALESCE(r.returned_bottles, 0)) / 24) AS closing_crates,
  MOD((COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
    + COALESCE(d.bottles, 0) - COALESCE(r.returned_bottles, 0)), 24) AS closing_loose
FROM public.customers c
LEFT JOIN delivered d ON d.customer_id = c.id
LEFT JOIN returns   r ON r.customer_id = c.id;

COMMENT ON VIEW public.hotel_closing_stock IS
  'Unified closing-stock ledger per hotel: opening + delivered (from bill items JSONB) - returned (from crate_entries). 24 bottles/crate for Goli Fizz/Blast, 30 for Petbottle. Identical to the app frontend calculation.';

GRANT SELECT ON public.hotel_closing_stock TO authenticated;

-- ------------------------------------------------------------------
-- hotel_closing_stock_before_bill(bill_id)
--   Returns the closing stock for a customer EXCLUDING a specific bill's
--   delivery and its synced crate-entry.  Used by the thermal print to
--   show "Previous Closing Stock" (the stock the hotel held before this
--   bill's items were delivered and before this bill's returns).
-- ------------------------------------------------------------------
-- Drop any leftover old-signature overload (an earlier version of this
-- migration declared the parameter as `text` instead of `uuid`) so we don't
-- end up with two overloaded functions of the same name sitting side by side.
DROP FUNCTION IF EXISTS public.hotel_closing_stock_before_bill(text);

CREATE OR REPLACE FUNCTION public.hotel_closing_stock_before_bill(p_bill_id uuid)
RETURNS TABLE (customer_id text, closing_bottles numeric, closing_crates numeric, closing_loose numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH target AS (
    SELECT customer_id FROM public.bills WHERE id = p_bill_id LIMIT 1
  ),
  delivered AS (
    SELECT b.customer_id,
      COALESCE(SUM(
        COALESCE((it->>'crates')::numeric, 0) *
          CASE WHEN it->>'category' = 'Petbottle' THEN 30 ELSE 24 END
        + COALESCE((it->>'loose')::numeric, 0)
      ), 0) AS bottles
    FROM public.bills b,
      jsonb_array_elements(COALESCE(b.items, '[]'::jsonb)) AS it
    WHERE b.id <> p_bill_id
    GROUP BY b.customer_id
  ),
  returns AS (
    SELECT customer_id,
      COALESCE(SUM(crates_returned), 0) * 24
      + COALESCE(SUM(loose_bottles_returned), 0)
      + COALESCE(SUM(damaged_bottles), 0) AS returned_bottles
    FROM public.crate_entries
    WHERE bill_id <> p_bill_id OR bill_id IS NULL
    GROUP BY customer_id
  )
  SELECT
    c.id::text,
    (COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
      + COALESCE(d.bottles, 0) - COALESCE(r.returned_bottles, 0)),
    FLOOR((COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
      + COALESCE(d.bottles, 0) - COALESCE(r.returned_bottles, 0)) / 24),
    MOD((COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
      + COALESCE(d.bottles, 0) - COALESCE(r.returned_bottles, 0)), 24)
  FROM public.customers c
  JOIN target t ON t.customer_id = c.id
  LEFT JOIN delivered d ON d.customer_id = c.id
  LEFT JOIN returns   r ON r.customer_id = c.id;
$$;

GRANT EXECUTE ON FUNCTION public.hotel_closing_stock_before_bill(uuid) TO authenticated;

-- ===================================================================
-- End of migration
-- ===================================================================