-- =====================================================================
-- SVB — Invoice series & pending-bills reporting
-- File: supabase/migrations/005_invoice_series_and_pending_bills.sql
-- Additive to 001–004. Reflects the app changes:
--   * Settings → Invoice Series: prefix + current bill number editable
--     and saved; bill generation queries the active series, appends the
--     next sequence number and auto-increments the stored counter.
--   * Default fallback series (GST: INV-1001, Non-GST: NG-1001) created
--     automatically if no active series exists.
--   * Bill Entries: pending-bills warning banner per customer, backed by
--     the v_customer_pending_bills view.
-- =====================================================================

-- One active series per bill type.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_series_type_key') THEN
    ALTER TABLE public.invoice_series ADD CONSTRAINT invoice_series_type_key UNIQUE (type);
  END IF;
END;
$$;

-- Default fallback series (no-op if rows already exist).
INSERT INTO public.invoice_series (id, type, prefix, series_name, next_number, padding)
VALUES (gen_random_uuid(), 'gst', 'INV-', 'GST Series', 1001, 4)
ON CONFLICT (type) DO NOTHING;

INSERT INTO public.invoice_series (id, type, prefix, series_name, next_number, padding)
VALUES (gen_random_uuid(), 'non_gst', 'NG-', 'Non-GST Series', 1001, 4)
ON CONFLICT (type) DO NOTHING;

-- next_invoice_number(type): returns the next invoice number and atomically
-- increments the stored counter. Mirrors the app's invoiceSeries utility.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_next numeric;
  v_padding numeric;
BEGIN
  INSERT INTO public.invoice_series (id, type, prefix, series_name, next_number, padding)
  VALUES (gen_random_uuid(),
    p_type,
    CASE WHEN p_type = 'gst' THEN 'INV-' ELSE 'NG-' END,
    CASE WHEN p_type = 'gst' THEN 'GST Series' ELSE 'Non-GST Series' END,
    1001, 4)
  ON CONFLICT (type) DO NOTHING;

  UPDATE public.invoice_series
  SET next_number = next_number + 1
  WHERE type = p_type
  RETURNING prefix, next_number - 1, padding INTO v_prefix, v_next, v_padding;

  RETURN v_prefix || lpad(v_next::text, v_padding::int, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_number(text) TO authenticated;

-- Pending (unpaid) bills per customer — backs the Bill Entries warning banner:
--   select * from v_customer_pending_bills where customer_id = '<id>';
CREATE OR REPLACE VIEW public.v_customer_pending_bills AS
SELECT customer_id,
  count(*) AS pending_count,
  sum(greatest(total - coalesce(paid_amount, 0), 0)) AS unpaid_balance
FROM public.bills
WHERE coalesce(payment_status, 'pending') = 'pending'
GROUP BY customer_id;

-- ===================================================================
-- End of migration
-- ===================================================================