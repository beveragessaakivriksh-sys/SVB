import { db } from "@/api/db";

import { todayISO } from "@/lib/constants";
import { itemAmount, itemBottles, computeBillTotals, getProductPrice } from "@/lib/billUtils";
import { nextInternalNumber } from "@/lib/invoiceSeries";

// Creates a NEW pending order dated TODAY from an existing order / bill's
// customer + items. Rates are refreshed from the customer's CURRENT prices
// (falling back to the old rate if the customer has none configured).
export async function cloneToTodayOrder({ customer, items, user }) {
  const rows = (items || [])
    .filter((it) => (Number(it.crates) || 0) > 0 || (Number(it.loose) || 0) > 0)
    .map((it) => {
      const rate = Number(getProductPrice(customer, it.category, it.flavour)) || Number(it.rate) || 0;
      const base = { ...it, crates: Number(it.crates) || 0, loose: Number(it.loose) || 0, rate };
      return { ...base, amount: itemAmount(base) };
    });
  if (rows.length === 0) throw new Error("Nothing to clone — this order has no items");

  const totals = computeBillTotals(rows, customer.has_gst);
  const { number } = await nextInternalNumber();

  return db.entities.Order.create({
    customer_id: customer.id,
    customer_name: customer.customer_name,
    display_name: customer.display_name || customer.customer_name,
    has_gst: customer.has_gst,
    internal_invoice_number: number,
    invoice_number: null,
    invoice_series: null,
    order_date: todayISO(),
    items: rows,
    total_bottles: rows.reduce((s, it) => s + itemBottles(it), 0),
    total_amount: totals.total,
    dispatch_status: "pending",
    created_by_name: user?.email || "unknown",
  });
}