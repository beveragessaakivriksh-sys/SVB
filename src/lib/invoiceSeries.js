import { db } from "@/api/db";


import { padNumber } from "./billUtils";

// Default fallback series used when no active series exists for a bill type.
export const DEFAULT_SERIES = {
  gst: { type: "gst", prefix: "INV-", series_name: "GST Series", next_number: 1001, padding: 4 },
  non_gst: { type: "non_gst", prefix: "NG-", series_name: "Non-GST Series", next_number: 1001, padding: 4 },
  // Internal series: numbers the internal orders created in Incoming Orders.
  // The real (GST / Non-GST) invoice number is only taken at dispatch.
  internal: { type: "internal", prefix: "INT-", series_name: "Internal Series", next_number: 1, padding: 4 },
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

// Generates the next INTERNAL order number (used by Incoming Orders). Same
// logic as nextInvoiceNumber, but on the separate "internal" series, so
// creating an order does not use up a real invoice number.
export async function nextInternalNumber() {
  const ser = await ensureInvoiceSeries("internal");
  const number = `${ser.prefix}${padNumber(ser.next_number, ser.padding)}`;
  await db.entities.InvoiceSeries.update(ser.id, { next_number: (Number(ser.next_number) || 0) + 1 });
  return { number, seriesName: ser.series_name };
}
