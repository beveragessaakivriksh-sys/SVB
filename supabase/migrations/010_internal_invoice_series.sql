-- Orders created in Incoming Orders now get an INTERNAL number from a separate
-- series. invoice_series.type only allowed ('gst','non_gst'); allow 'internal'.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.invoice_series'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%non_gst%'
  LOOP
    EXECUTE format('ALTER TABLE public.invoice_series DROP CONSTRAINT %I', c.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.invoice_series DROP CONSTRAINT IF EXISTS invoice_series_type_check;
ALTER TABLE public.invoice_series
  ADD CONSTRAINT invoice_series_type_check CHECK (type IN ('gst', 'non_gst', 'internal'));

INSERT INTO public.invoice_series (id, type, prefix, series_name, next_number, padding)
VALUES (gen_random_uuid(), 'internal', 'INT-', 'Internal Series', 1, 4)
ON CONFLICT (type) DO NOTHING;