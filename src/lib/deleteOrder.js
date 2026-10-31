import { db } from "@/api/db";

// Finds the invoice (bill) linked to an order: by bill_id, or — for older
// orders where that link was never saved — by matching invoice number.
export function findOrderBill(order, bills = []) {
  return (
    bills.find((b) => b.id === order.bill_id) ||
    (order.invoice_number ? bills.find((b) => b.invoice_number === order.invoice_number) : undefined)
  );
}

// Deletes an order. If it was already dispatched, the linked invoice (bill)
// is deleted too, together with its delivery and any crate-return entry that
// was synced from that bill — otherwise those would be left behind and keep
// counting towards the hotel's stock figures.
export async function deleteOrderCascade(order, bills = [], deliveries = []) {
  const bill = findOrderBill(order, bills);
  if (bill) {
    const crateEntries = await db.entities.CrateEntry.filter({ bill_id: bill.id });
    for (const c of crateEntries) await db.entities.CrateEntry.delete(c.id);
    for (const d of deliveries.filter((x) => x.bill_id === bill.id)) await db.entities.Delivery.delete(d.id);
    await db.entities.Bill.delete(bill.id);
  }
  await db.entities.Order.delete(order.id);
  return { bill };
}