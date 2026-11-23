import supabase from "@/lib/supabaseClient";
import { db } from "@/api/db";

import { padNumber } from "./billUtils";

// Default fallback series used when no active series exists for a bill type.
export const DEFAULT_SERIES = {
  gst: { type: "gst", prefix: "INV-", series_name: "GST Series", next_number: 1001, padding: 4 },
  non_gst: { type: "non_gst", prefix: "NG-", series_name: "Non-GST Series", next_number: 1001, padding: 4 },
  // Internal series: numbers the internal orders created in Incoming Orders.
  // The real (GST / Non-GST) invoice number is only taken at dispatch.
  internal: { type: "internal", prefix: "INT-", series_name: "Internal Series", next_number: 1, padding: 4 },
  // Legacy shared distributor series. Kept as a fallback for distributors that
  // have no per-distributor series configured yet (migration 011).
  distributor: { type: "distributor", prefix: "DST-", series_name: "Distributors Invoice Number", next_number: 1001, padding: 4 },
};

// Returns the active series for a bill type, or null.
export async function getActiveSeries(type) {
  const list = await db.entities.InvoiceSeries.filter({ type });
  return list[0] || null;
}

// Returns the active series for a bill type, creating the default fallback
// series (e.g. INV-1001) if none exists yet.
export async function ensureInvoiceSeries(type) {
  const existing = await getActiveSeries(type);
  if (existing) return existing;
  return db.entities.InvoiceSeries.create({ ...DEFAULT_SERIES[type] });
}

// Generates the next invoice number for a bill: queries the active series,
// appends the next sequence number, and increments the stored counter.
export async function nextInvoiceNumber(hasGst) {
  const type = hasGst ? "gst" : "non_gst";
  const ser = await ensureInvoiceSeries(type);
  const number = `${ser.prefix}${padNumber(ser.next_number, ser.padding)}`;
  await db.entities.InvoiceSeries.update(ser.id, { next_number: (Number(ser.next_number) || 0) + 1 });
  return { number, seriesName: ser.series_name };
}

// Generates the next INTERNAL order number (used by Incoming Orders).
export async function nextInternalNumber() {
  const ser = await ensureInvoiceSeries("internal");
  const number = `${ser.prefix}${padNumber(ser.next_number, ser.padding)}`;
  await db.entities.InvoiceSeries.update(ser.id, { next_number: (Number(ser.next_number) || 0) + 1 });
  return { number, seriesName: ser.series_name };
}

// A readable default prefix derived from the distributor name, e.g.
// "Shree Beverages" -> "SB-". Unique-looking names get unique-looking series.
export function defaultDistributorPrefix(name = "") {
  const initials = String(name)
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 4);
  return `${initials || "DIST"}-`;
}

// Generates the next DISTRIBUTOR invoice number.
//
// Every distributor owns its own prefix + counter (fields on the distributor
// row, editable in Settings → Distributor Invoice Numbers), so two
// distributors never share an invoice number sequence. The counter increment
// is done atomically by the `next_distributor_invoice_number` SQL function;
// the JS fallback keeps the app working if that migration has not been run.
export async function nextDistributorInvoiceNumber(distributor) {
  if (distributor?.id) {
    const prefix = distributor.invoice_prefix || defaultDistributorPrefix(distributor.distributor_name || distributor.display_name);
    const next = Number(distributor.invoice_next_number) || 1001;
    const padding = Number(distributor.invoice_padding) || 4;
    const seriesName = distributor.series_name || `${prefix}Distributor Series`;

    try {
      const { data, error } = await supabase.rpc("next_distributor_invoice_number", { p_distributor_id: distributor.id });
      if (!error && data) return { number: String(data), seriesName };
    } catch {
      // Fall through to the client-side fallback below.
    }

    const number = `${prefix}${padNumber(next, padding)}`;
    try {
      await db.entities.Distributor.update(distributor.id, { invoice_next_number: next + 1 });
    } catch {
      // Best-effort: still return a usable number when the row cannot be
      // written (e.g. RLS not applied yet).
    }
    return { number, seriesName };
  }

  // Legacy fallback for an order whose distributor record was deleted.
  const ser = await ensureInvoiceSeries("distributor");
  const number = `${ser.prefix}${padNumber(ser.next_number, ser.padding)}`;
  await db.entities.InvoiceSeries.update(ser.id, { next_number: (Number(ser.next_number) || 0) + 1 });
  return { number, seriesName: ser.series_name };
}
