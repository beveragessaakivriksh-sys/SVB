import { db } from "@/api/db";

import { useEffect, useMemo, useState } from "react";

import PageShell from "@/components/PageShell";
import { Stepper } from "@/components/Stepper";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { todayISO } from "@/lib/constants";
import { buildItemsFromProductList, computeBillTotals, getProductPrice, itemBottles, itemAmount, sortCustomersAlpha } from "@/lib/billUtils";
import { nextInternalNumber } from "@/lib/invoiceSeries";
import { useProducts } from "@/lib/useProducts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, AlertCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function NewDelivery() {
  const user = useCurrentUser();
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const { productList, categories, flavoursByCategory } = useProducts();
  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(todayISO());
  const [items, setItems] = useState(buildItemsFromProductList(productList));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    db.entities.Customer.list().then((list) => setCustomers(sortCustomersAlpha(list)));
  }, []);

  // Keep the item matrix in sync with managed products (Settings), preserving
  // any quantities the user has already entered for matching SKUs.
  useEffect(() => {
    setItems((prev) =>
      productList.map((p) => {
        const existing = prev.find((x) => x.category === p.category && x.flavour === p.flavour);
        return existing ? { ...existing, label: p.label } : { ...p, crates: 0, loose: 0, rate: 0, amount: 0 };
      })
    );
  }, [productList]);

  const customer = customers.find((c) => c.id === customerId);

  useEffect(() => {
    if (!customer) return;
    setItems((prev) =>
      prev.map((it) => ({ ...it, rate: getProductPrice(customer, it.category, it.flavour) }))
    );
  }, [customerId]);

  const updateItem = (idx, field, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const activeItems = items.filter((it) => (Number(it.crates) > 0 || Number(it.loose) > 0));
  const totals = useMemo(() => computeBillTotals(activeItems, customer?.has_gst), [activeItems, customer]);

  const handleSave = async () => {
    if (!customer) return toast({ variant: "destructive", title: "Select a customer" });
    if (activeItems.length === 0) return toast({ variant: "destructive", title: "Add at least one item" });
    setSaving(true);
    try {
      // Takes the next number from the INTERNAL series (Settings → Invoice
      // Series) and auto-increments it. The real GST / Non-GST invoice number
      // is only taken later, when the order is dispatched from the Orders tab.
      const { number: internalNumber } = await nextInternalNumber();
      const date = orderDate;
      const itemsWithAmount = activeItems.map((it) => ({
        ...it,
        crates: Number(it.crates) || 0,
        loose: Number(it.loose) || 0,
        rate: Number(it.rate) || 0,
        amount: itemAmount(it),
      }));
      const totalBottles = itemsWithAmount.reduce((s, it) => s + itemBottles(it), 0);

      // Every incoming order creates an internal Order (reflected in Orders tab)
      await db.entities.Order.create({
        customer_id: customer.id,
        customer_name: customer.customer_name,
        display_name: customer.display_name || customer.customer_name,
        has_gst: customer.has_gst,
        internal_invoice_number: internalNumber,
        invoice_number: null,
        invoice_series: null,
        order_date: date,
        items: itemsWithAmount,
        total_bottles: totalBottles,
        total_amount: totals.total,
        dispatch_status: "pending",
        created_by_name: user?.email || "unknown",
      });

      // The bill (invoice) is created when the order is dispatched from the
      // Orders tab — for GST and Non-GST orders alike.
      toast({ title: "Order saved", description: `${internalNumber} in Orders (pending dispatch)` });

      setItems(buildItemsFromProductList(productList));
      setCustomerId("");
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="Incoming Orders"
      subtitle="Record incoming orders — an internal invoice is created and dispatched from the Orders tab"
      actions={
        <Button disabled={saving || activeItems.length === 0} onClick={handleSave}>
          <Save className="h-4 w-4 mr-2" /> Save Order
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-primary/20 bg-white p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Customer / Hotel</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.display_name || c.customer_name} {c.has_gst ? "(GST)" : "(Non-GST)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Order Date</Label>
                <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-primary/20 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-primary">Add Products</h3>
            <div className="space-y-4">
              {categories.map((cat) => (
                <div key={cat}>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-primary">{cat}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {flavoursByCategory(cat).map((fl) => {
                      const idx = items.findIndex((i) => i.category === cat && i.flavour === fl);
                      const it = items[idx];
                      if (!it) return null;
                      return (
                        <div key={`${cat}-${fl}`} className="flex items-center justify-between gap-2 rounded-lg border border-primary/10 bg-primary/5 px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{fl}</div>
                            <div className="text-[11px] text-muted-foreground">₹{Number(it.rate) || 0}/btl</div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground">Crates</span>
                              <Stepper value={it.crates} onChange={(v) => updateItem(idx, "crates", v)} />
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground">Loose</span>
                              <Stepper value={it.loose} onChange={(v) => updateItem(idx, "loose", v)} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <h3 className="mb-3 text-sm font-semibold text-primary">Order Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>₹ {totals.subtotal.toFixed(2)}</span></div>
              {customer?.has_gst && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>₹ {totals.tax.toFixed(2)}</span></div>}
              <div className="flex justify-between border-t border-primary/20 pt-2 text-base font-bold text-primary"><span>Total</span><span>₹ {totals.total.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total Bottles</span><span>{activeItems.reduce((s, it) => s + itemBottles(it), 0)}</span></div>
            </div>
          </div>

          {!customer && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              <AlertCircle className="h-4 w-4" /> Select a customer to begin.
            </div>
          )}
        </div>
      </div>
      {/* Bottom summary + save */}
      <div className="mt-4 rounded-xl border border-primary/20 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-primary">Order Summary</h3>
        {activeItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products selected yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">Product</th><th className="p-2 text-center">Crates</th><th className="p-2 text-center">Loose</th><th className="p-2 text-center">Bottles</th><th className="p-2 text-right">Rate/btl</th><th className="p-2 text-right">Amount</th></tr></thead>
              <tbody>
                {activeItems.map((it, i) => (
                  <tr key={i} className="border-t border-primary/10">
                    <td className="p-2">{it.label}</td>
                    <td className="p-2 text-center">{Number(it.crates) || 0}</td>
                    <td className="p-2 text-center">{Number(it.loose) || 0}</td>
                    <td className="p-2 text-center">{itemBottles(it)}</td>
                    <td className="p-2 text-right">₹ {(Number(it.rate) || 0).toFixed(2)}</td>
                    <td className="p-2 text-right">₹ {itemAmount(it).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between gap-10"><span className="text-muted-foreground">Subtotal</span><span>₹ {totals.subtotal.toFixed(2)}</span></div>
            {customer?.has_gst && <div className="flex justify-between gap-10"><span className="text-muted-foreground">Tax</span><span>₹ {totals.tax.toFixed(2)}</span></div>}
            <div className="flex justify-between gap-10 border-t border-primary/20 pt-1 text-base font-bold text-primary"><span>Total</span><span>₹ {totals.total.toFixed(2)}</span></div>
          </div>
          <Button disabled={saving || activeItems.length === 0} onClick={handleSave}><Save className="h-4 w-4 mr-2" /> Save Order</Button>
        </div>
      </div>
    </PageShell>
  );
}