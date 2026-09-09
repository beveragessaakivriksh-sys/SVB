import { CATEGORIES, FLAVOURS, priceKey, BOTTLES_PER_CRATE, CGST_RATE, SGST_RATE, bottlesPerCrate } from "./constants";

export function itemBottles(item) {
  return (Number(item.crates) || 0) * bottlesPerCrate(item.category) + (Number(item.loose) || 0);
}

export function itemAmount(item) {
  return +(itemBottles(item) * (Number(item.rate) || 0)).toFixed(2);
}

export function computeBillTotals(items, hasGst) {
  const subtotal = items.reduce((s, it) => s + itemAmount(it), 0);
  const tax = hasGst ? +(subtotal * ((CGST_RATE + SGST_RATE) / 100)).toFixed(2) : 0;
  return {
    subtotal: +subtotal.toFixed(2),
    tax,
    total: +(subtotal + tax).toFixed(2),
  };
}

export function buildEmptyItems() {
  return CATEGORIES.flatMap((cat) =>
    FLAVOURS.map((fl) => ({
      category: cat,
      flavour: fl,
      label: `${cat} - ${fl}`,
      crates: 0,
      loose: 0,
      rate: 0,
      amount: 0,
    }))
  );
}

// Build an empty item matrix from a dynamic product list (managed in Settings).
export function buildItemsFromProductList(productList) {
  return (productList || []).map((p) => ({
    category: p.category,
    flavour: p.flavour,
    label: p.label || `${p.category} - ${p.flavour}`,
    crates: 0,
    loose: 0,
    rate: 0,
    amount: 0,
  }));
}

export function padNumber(n, padding) {
  return String(n).padStart(padding || 4, "0");
}

export function formatInvoiceNumber(series, num) {
  return `${series.prefix}${padNumber(num, series.padding)}`;
}

export function getProductPrice(customer, category, flavour) {
  if (!customer) return 0;
  const prices = customer.product_prices || {};
  const key = priceKey(category, flavour);
  if (prices[key] && prices[key].selling_price != null) return prices[key].selling_price;
  // fallback to category MRP
  const mrpField = category === "Goli Fizz" ? "goli_fizz_mrp" : category === "Goli Blast" ? "goli_blast_mrp" : "petbottle_mrp";
  return Number(customer[mrpField]) || 0;
}

export function getMrpForCategory(customer, category) {
  if (!customer) return 0;
  const mrpField = category === "Goli Fizz" ? "goli_fizz_mrp" : category === "Goli Blast" ? "goli_blast_mrp" : "petbottle_mrp";
  return Number(customer[mrpField]) || 0;
}

export function totalBottles(items) {
  return (items || []).reduce((s, it) => s + itemBottles(it), 0);
}

export function bottlesToCrateLoose(bottles, size = BOTTLES_PER_CRATE) {
  const b = Math.max(0, Math.floor(Number(bottles) || 0));
  return { crates: Math.floor(b / size), loose: b % size };
}

export function customerClosingStock(customer, bills = [], crateEntries = []) {
  const cid = customer?.id;
  const startCrates = Number(customer?.closing_stock_crates) || 0;
  const startLoose = Number(customer?.closing_stock_loose) || 0;
  let bottles = startCrates * BOTTLES_PER_CRATE + startLoose;
  (bills || []).forEach((b) => { if (b.customer_id === cid) bottles += totalBottles(b.items || []); });
  (crateEntries || []).forEach((e) => {
    if (e.customer_id === cid) bottles -= (Number(e.crates_returned) || 0) * BOTTLES_PER_CRATE + (Number(e.loose_bottles_returned) || 0) + (Number(e.damaged_bottles) || 0);
  });
  return bottlesToCrateLoose(bottles);
}

// Hotel closing stock computed from the full delivery + crate-return history.
// Pass excludeBillId to get the stock "before this bill" (previous closing stock).
export function hotelClosingStock(customer, bills = [], crateEntries = [], { excludeBillId } = {}) {
  const cid = customer?.id;
  const startCrates = Number(customer?.closing_stock_crates) || 0;
  const startLoose = Number(customer?.closing_stock_loose) || 0;
  let bottles = startCrates * BOTTLES_PER_CRATE + startLoose;
  (bills || []).forEach((b) => {
    if (b.customer_id === cid && b.id !== excludeBillId) bottles += totalBottles(b.items || []);
  });
  (crateEntries || []).forEach((e) => {
    if (e.customer_id === cid && e.bill_id !== excludeBillId)
      bottles -= (Number(e.crates_returned) || 0) * BOTTLES_PER_CRATE + (Number(e.loose_bottles_returned) || 0) + (Number(e.damaged_bottles) || 0);
  });
  return bottlesToCrateLoose(bottles);
}

export function computeClosingStock(bill, customer) {
  const startCrates = Number(customer?.closing_stock_crates) || 0;
  const startLoose = Number(customer?.closing_stock_loose) || 0;
  let bottles = startCrates * BOTTLES_PER_CRATE + startLoose;
  bottles += totalBottles(bill.items || []);
  bottles -= (Number(bill.returned_crates) || 0) * BOTTLES_PER_CRATE;
  bottles -= Number(bill.damaged_bottles) || 0;
  return bottlesToCrateLoose(bottles);
}

// Previous closing stock = the manual opening stock recorded on the customer
// (before this bill's delivery / returns are applied).
export function previousClosingStock(customer) {
  return {
    crates: Number(customer?.closing_stock_crates) || 0,
    loose: Number(customer?.closing_stock_loose) || 0,
  };
}

export const THERMAL_LIABILITY =
  "Crates & bottles are properties of the manufacturer, you are liable to return it back. In case lost or damaged Rs. 60 will be charged per bottle and Rs. 600 per crate.";

export const THERMAL_WIDTH = 48;

export const balanceDue = (bill) => {
  const total = Number(bill?.total) || 0;
  const paid = Number(bill?.paid_amount) || 0;
  if ((bill?.payment_status || "pending") === "completed") return 0;
  return +(Math.max(0, total - paid)).toFixed(2);
};

export const isPartialPayment = (bill) =>
  (bill?.payment_status || "pending") === "pending" && (Number(bill?.paid_amount) || 0) > 0;

export function thermalContent(bill, customer, ctx = {}) {
  const items = (bill.items || []).filter((it) => (Number(it.crates) || 0) + (Number(it.loose) || 0) > 0);
  const subtotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  // Previous Closing Stock = hotel stock BEFORE this bill's delivery/returns.
  // Closing Stock (Hotel) = hotel stock AFTER this bill's delivery/returns.
  // When a delivery + crate-entry history is supplied, compute from the full ledger;
  // otherwise fall back to the per-bill approximation (manual opening + this bill only).
  let previousStock;
  let closingStock;
  if (ctx.bills && ctx.crateEntries) {
    previousStock = hotelClosingStock(customer, ctx.bills, ctx.crateEntries, { excludeBillId: bill.id });
    closingStock = customerClosingStock(customer, ctx.bills, ctx.crateEntries);
  } else {
    previousStock = previousClosingStock(customer);
    closingStock = computeClosingStock(bill, customer);
  }
  return {
    hotel: bill.customer_name || customer?.customer_name || "",
    invoiceNumber: bill.invoice_number || "",
    date: bill.invoice_date || "",
    paymentStatus: bill.payment_status || "pending",
    items: items.map((it) => ({
      name: it.label || `${it.category} - ${it.flavour}`,
      crates: Number(it.crates) || 0,
      loose: Number(it.loose) || 0,
      bottles: itemBottles(it),
      rate: Number(it.rate) || 0,
      amount: Number(it.amount) || 0,
    })),
    subtotal,
    tax: Number(bill.tax_total) || 0,
    total: Number(bill.total) || 0,
    paid: Number(bill.paid_amount) || 0,
    balance: balanceDue(bill),
    emptyCrates: Number(bill.returned_crates) || 0,
    closingStock,
    previousStock,
  };
}