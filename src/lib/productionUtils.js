import { bottlesPerCrate } from "./constants";
import { itemBottles } from "./billUtils";

export const productKey = (category, flavour) => `${category}|${flavour}`;

export function toQuantityMap(entries = []) {
  const map = {};
  (entries || []).forEach((entry) => {
    const key = productKey(entry.category, entry.flavour);
    map[key] = (map[key] || 0) + (Number(entry.quantity) || 0);
  });
  return map;
}

export function sumQuantities(entries = []) {
  return (entries || []).reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
}

// Build a grid that always follows the current product list (Settings can add
// or retire flavours), preserving quantities saved for matching products.
export function buildGrid(productList = [], source = []) {
  const quantities = toQuantityMap(source);
  return (productList || []).map((product) => {
    const key = productKey(product.category, product.flavour);
    return {
      key,
      category: product.category,
      flavour: product.flavour,
      label: product.label || `${product.category} - ${product.flavour}`,
      quantity: quantities[key] ?? 0,
    };
  });
}

// Demand for a production date. A dispatched order and its invoice describe the
// same bottles, so count the invoice once and use the order only when no invoice
// is linked. Standalone invoices are included too.
export function buildDemandMap({
  orders = [],
  bills = [],
  date,
  orderDateKey = "order_date",
  billDateKey = "invoice_date",
} = {}) {
  const demand = {};
  if (!date) return demand;

  const dayOrders = (orders || []).filter((order) => order?.[orderDateKey] === date);
  const dayBills = (bills || []).filter((bill) => bill?.[billDateKey] === date);

  const billsById = new Map(dayBills.map((bill) => [bill.id, bill]));
  const billsByInvoice = new Map(
    dayBills.filter((bill) => bill.invoice_number).map((bill) => [bill.invoice_number, bill])
  );
  const usedBillIds = new Set();

  const addItems = (items) => {
    (items || []).forEach((item) => {
      const key = productKey(item.category, item.flavour);
      demand[key] = (demand[key] || 0) + itemBottles(item);
    });
  };

  dayOrders.forEach((order) => {
    const linkedBill =
      (order.bill_id && billsById.get(order.bill_id)) ||
      (order.invoice_number && billsByInvoice.get(order.invoice_number)) ||
      null;

    if (linkedBill) {
      // Two orders can point at the same invoice; count its bottles once.
      if (usedBillIds.has(linkedBill.id)) return;
      usedBillIds.add(linkedBill.id);
      addItems((linkedBill.items || []).length ? linkedBill.items : order.items);
    } else {
      addItems(order.items);
    }
  });

  dayBills.forEach((bill) => {
    if (usedBillIds.has(bill.id)) return;
    addItems(bill.items);
  });

  return demand;
}

export function availabilityStatus(row) {
  if (row.shortfall > 0) return "short";
  if (row.ordered > 0 && row.available === 0) return "tight";
  if (row.produced > 0 || row.closing > 0 || row.ordered > 0) return "ok";
  return "idle";
}

export function buildAvailabilityRows({ productList = [], produced = {}, closing = {}, demand = {} } = {}) {
  return (productList || []).map((product) => {
    const key = productKey(product.category, product.flavour);
    const producedQty = Number(produced[key]) || 0;
    const closingQty = Number(closing[key]) || 0;
    const orderedQty = Number(demand[key]) || 0;
    const available = closingQty + producedQty - orderedQty;
    const shortfall = Math.max(0, orderedQty - closingQty - producedQty);

    const row = {
      key,
      category: product.category,
      flavour: product.flavour,
      produced: producedQty,
      closing: closingQty,
      ordered: orderedQty,
      available,
      shortfall,
    };
    return { ...row, status: availabilityStatus(row) };
  });
}

export function availabilityTotals(rows = []) {
  return (rows || []).reduce(
    (totals, row) => ({
      produced: totals.produced + row.produced,
      closing: totals.closing + row.closing,
      ordered: totals.ordered + row.ordered,
      available: totals.available + row.available,
      shortfall: totals.shortfall + row.shortfall,
    }),
    { produced: 0, closing: 0, ordered: 0, available: 0, shortfall: 0 }
  );
}

// ---------------------------------------------------------------------------
// Morning factory stock (crates + loose) and the resulting production plan
// ---------------------------------------------------------------------------

export function toOpeningStockMap(rows = []) {
  const map = {};
  (rows || []).forEach((row) => {
    const key = productKey(row.category, row.flavour);
    const crates = Number(row.crates) || 0;
    const loose = Number(row.loose) || 0;
    const current = map[key] || { crates: 0, loose: 0, bottles: 0 };
    current.crates += crates;
    current.loose += loose;
    current.bottles += crates * bottlesPerCrate(row.category) + loose;
    map[key] = current;
  });
  return map;
}

export function buildOpeningStockGrid(productList = [], source = []) {
  const stock = toOpeningStockMap(source);
  return (productList || []).map((product) => {
    const key = productKey(product.category, product.flavour);
    const current = stock[key] || { crates: 0, loose: 0 };
    return {
      key,
      category: product.category,
      flavour: product.flavour,
      label: product.label || `${product.category} - ${product.flavour}`,
      crates: current.crates,
      loose: current.loose,
    };
  });
}

export function openingStockTotals(rows = []) {
  return (rows || []).reduce(
    (total, row) => {
      const crates = Number(row.crates) || 0;
      const loose = Number(row.loose) || 0;
      return {
        crates: total.crates + crates,
        loose: total.loose + loose,
        bottles: total.bottles + crates * bottlesPerCrate(row.category) + loose,
      };
    },
    { crates: 0, loose: 0, bottles: 0 }
  );
}

// One row per order line for the selected day, with the party resolved by the
// caller (customer, distributor or a hotel under a distributor).
export function buildDailyOrderDetail({ orders = [], date, partyLabel = () => ({}) } = {}) {
  const rows = [];
  if (!date) return rows;
  (orders || [])
    .filter((order) => order?.order_date === date)
    .forEach((order) => {
      const party = partyLabel(order) || {};
      (order.items || []).forEach((item, index) => {
        const crates = Number(item.crates) || 0;
        const loose = Number(item.loose) || 0;
        if (!crates && !loose) return;
        rows.push({
          key: `${order.id || order.internal_invoice_number || "order"}-${index}`,
          orderNo: order.internal_invoice_number || "",
          partyName: party.name || order.display_name || order.customer_name || "Unknown",
          partyType: party.type || "Customer",
          category: item.category,
          flavour: item.flavour,
          crates,
          loose,
          bottles: crates * bottlesPerCrate(item.category) + loose,
        });
      });
    });
  return rows.sort(
    (a, b) =>
      a.partyName.localeCompare(b.partyName) ||
      a.category.localeCompare(b.category) ||
      a.flavour.localeCompare(b.flavour)
  );
}

// Opening stock is subtracted from that day's order demand. Anything still
// needed is the production target, expressed in bottles and crates+loose.
export function buildProductionPlan({ productList = [], opening = {}, demand = {} } = {}) {
  return (productList || []).map((product) => {
    const key = productKey(product.category, product.flavour);
    const stock = opening[key] || { crates: 0, loose: 0, bottles: 0 };
    const openingBottles = Number(stock.bottles) || 0;
    const ordered = Number(demand[key]) || 0;
    const perCrate = bottlesPerCrate(product.category);
    const pending = Math.max(0, ordered - openingBottles);
    const row = {
      key,
      category: product.category,
      flavour: product.flavour,
      label: product.label || `${product.category} - ${product.flavour}`,
      ordered,
      orderedCrates: Math.floor(ordered / perCrate),
      orderedLoose: ordered % perCrate,
      openingCrates: Number(stock.crates) || 0,
      openingLoose: Number(stock.loose) || 0,
      openingBottles,
      pending,
      pendingCrates: Math.floor(pending / perCrate),
      pendingLoose: pending % perCrate,
      covered: ordered > 0 && pending === 0,
    };
    return { ...row, status: ordered === 0 ? "idle" : pending === 0 ? "ok" : "short" };
  });
}

export function productionPlanTotals(rows = []) {
  return (rows || []).reduce(
    (totals, row) => ({
      ordered: totals.ordered + row.ordered,
      openingBottles: totals.openingBottles + row.openingBottles,
      pending: totals.pending + row.pending,
      shortLines: totals.shortLines + (row.pending > 0 ? 1 : 0),
    }),
    { ordered: 0, openingBottles: 0, pending: 0, shortLines: 0 }
  );
}
