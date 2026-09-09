import { db } from "@/api/db";

import { Fragment, useEffect, useMemo, useState } from "react";

import PageShell from "@/components/PageShell";
import { priceKey } from "@/lib/constants";
import { customerClosingStock } from "@/lib/billUtils";
import { useProducts } from "@/lib/useProducts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

const EMPTY = {
  customer_name: "", display_name: "", has_gst: false, place_of_supply: "", place_of_supply_state_code: "", gst_treatment: "", gstin: "",
  billing_attention: "", billing_address: "", billing_street2: "", billing_city: "", billing_state: "", billing_country: "India", billing_code: "",
  shipping_attention: "", shipping_address: "", shipping_street2: "", shipping_city: "", shipping_state: "", shipping_country: "India", shipping_code: "",
  goli_fizz_mrp: 0, goli_blast_mrp: 0, petbottle_mrp: 0, payment_terms_label: "Due on Receipt", closing_stock_crates: 0, closing_stock_loose: 0, product_prices: {}, notes: "",
};

export default function Customers() {
  const { toast } = useToast();
  const { categories, flavoursByCategory } = useProducts();
  const [customers, setCustomers] = useState([]);
  const [bills, setBills] = useState([]);
  const [crateEntries, setCrateEntries] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setCustomers(await db.entities.Customer.list());
    setBills(await db.entities.Bill.list("-invoice_date", 500));
    setCrateEntries(await db.entities.CrateEntry.list("-entry_date", 500));
  };
  useEffect(() => { load(); }, []);

  const stockMap = useMemo(() => {
    const m = {};
    customers.forEach((c) => { m[c.id] = customerClosingStock(c, bills, crateEntries); });
    return m;
  }, [customers, bills, crateEntries]);

  const openNew = () => setEditing({ ...EMPTY, product_prices: {} });
  const openEdit = (c) => setEditing({ ...c, product_prices: c.product_prices || {} });

  const save = async () => {
    if (!editing.customer_name) return toast({ variant: "destructive", title: "Name required" });
    try {
      if (editing.id) await db.entities.Customer.update(editing.id, editing);
      else await db.entities.Customer.create(editing);
      toast({ title: "Customer saved" });
      setEditing(null);
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const remove = async (c) => {
    if (!confirm(`Delete ${c.customer_name}?`)) return;
    await db.entities.Customer.delete(c.id);
    load();
  };

  const set = (k, v) => setEditing((p) => ({ ...p, [k]: v }));
  const setPrice = (cat, fl, field, val) => {
    const key = priceKey(cat, fl);
    const pp = { ...(editing.product_prices || {}) };
    pp[key] = { ...(pp[key] || {}), [field]: Number(val) || 0 };
    set("product_prices", pp);
  };

  return (
    <PageShell title="Customers" subtitle="Manage hotels, GST details and per-product pricing" actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Add Customer</Button>}>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="p-3">Name</th><th className="p-3">Type</th><th className="p-3">GSTIN</th><th className="p-3">Place of Supply</th><th className="p-3 text-right">Closing Cr</th><th className="p-3 text-right">Closing Loose</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="p-3 font-medium">{c.display_name || c.customer_name}</td>
                <td className="p-3">{c.has_gst ? <span className="text-primary">GST</span> : <span className="text-muted-foreground">Non-GST</span>}</td>
                <td className="p-3 text-xs">{c.gstin || "—"}</td>
                <td className="p-3 text-xs">{c.place_of_supply_state_code || "—"}</td>
                <td className="p-3 text-right">{stockMap[c.id]?.crates ?? 0}</td>
                <td className="p-3 text-right">{stockMap[c.id]?.loose ?? 0}</td>
                <td className="p-3 text-right">
                  <button onClick={() => openEdit(c)} className="mr-2 text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(c)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
            {customers.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No customers yet</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Customer" : "Add Customer"}</DialogTitle></DialogHeader>
          {editing && (
            <Tabs defaultValue="basic">
              <TabsList className="grid w-full grid-cols-4"><TabsTrigger value="basic">Basic</TabsTrigger><TabsTrigger value="billing">Billing</TabsTrigger><TabsTrigger value="shipping">Shipping</TabsTrigger><TabsTrigger value="pricing">Pricing</TabsTrigger></TabsList>

              <TabsContent value="basic" className="space-y-3">
                <div><Label>Customer / Hotel Name</Label><Input value={editing.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></div>
                <div><Label>Display Name (in-app only)</Label><Input value={editing.display_name || ""} onChange={(e) => set("display_name", e.target.value)} placeholder="Optional name shown only in the app" /></div>
                <div className="flex items-center gap-2 rounded-lg border border-border p-3">
                  <Switch checked={editing.has_gst} onCheckedChange={(v) => set("has_gst", v)} />
                  <span className="text-sm">Has GST Registration</span>
                </div>
                {editing.has_gst && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><Label>GSTIN</Label><Input value={editing.gstin || ""} onChange={(e) => set("gstin", e.target.value)} /></div>
                    <div><Label>GST Treatment</Label><Input value={editing.gst_treatment || ""} onChange={(e) => set("gst_treatment", e.target.value)} placeholder="e.g. Business" /></div>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>Place of Supply</Label><Input value={editing.place_of_supply || ""} onChange={(e) => set("place_of_supply", e.target.value)} /></div>
                  <div><Label>Place of Supply (State Code)</Label><Input value={editing.place_of_supply_state_code || ""} onChange={(e) => set("place_of_supply_state_code", e.target.value)} /></div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>Payment Terms Label</Label><Input value={editing.payment_terms_label || ""} onChange={(e) => set("payment_terms_label", e.target.value)} /></div>
                  <div><Label>Closing Stock — Crates (manual)</Label><Input type="number" value={editing.closing_stock_crates || 0} onChange={(e) => set("closing_stock_crates", e.target.value)} /></div>
                  <div><Label>Closing Stock — Loose Bottles (manual)</Label><Input type="number" value={editing.closing_stock_loose || 0} onChange={(e) => set("closing_stock_loose", e.target.value)} /></div>
                </div>
                <div><Label>Notes</Label><Input value={editing.notes || ""} onChange={(e) => set("notes", e.target.value)} /></div>
              </TabsContent>

              <TabsContent value="billing" className="space-y-3">
                {["billing_attention", "billing_address", "billing_street2", "billing_city", "billing_state", "billing_country", "billing_code"].map((f) => (
                  <div key={f}><Label>{f.replace("billing_", "").replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}</Label><Input value={editing[f] || ""} onChange={(e) => set(f, e.target.value)} /></div>
                ))}
              </TabsContent>

              <TabsContent value="shipping" className="space-y-3">
                {["shipping_attention", "shipping_address", "shipping_street2", "shipping_city", "shipping_state", "shipping_country", "shipping_code"].map((f) => (
                  <div key={f}><Label>{f.replace("shipping_", "").replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}</Label><Input value={editing[f] || ""} onChange={(e) => set(f, e.target.value)} /></div>
                ))}
              </TabsContent>

              <TabsContent value="pricing" className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div><Label>Goli Fizz MRP</Label><Input type="number" value={editing.goli_fizz_mrp || 0} onChange={(e) => set("goli_fizz_mrp", e.target.value)} /></div>
                  <div><Label>Goli Blast MRP</Label><Input type="number" value={editing.goli_blast_mrp || 0} onChange={(e) => set("goli_blast_mrp", e.target.value)} /></div>
                  <div><Label>Petbottle MRP</Label><Input type="number" value={editing.petbottle_mrp || 0} onChange={(e) => set("petbottle_mrp", e.target.value)} /></div>
                </div>
                <div className="rounded-lg border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold">Per-Product Selling Price & MRP ({categories.reduce((n, c) => n + flavoursByCategory(c).length, 0)} SKUs)</div>
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted-foreground"><tr><th className="p-2">Product</th><th className="p-2 text-right">Selling Price</th><th className="p-2 text-right">Printed MRP</th></tr></thead>
                      <tbody>
                        {categories.map((cat) => (
                          <Fragment key={cat}>
                            <tr key={`h-${cat}`}><td colSpan={3} className="bg-muted/30 px-2 py-1 font-semibold text-primary">{cat}</td></tr>
                            {flavoursByCategory(cat).map((fl) => {
                              const key = priceKey(cat, fl);
                              const pp = editing.product_prices?.[key] || {};
                              return (
                                <tr key={key} className="border-t border-border/50">
                                  <td className="p-2">{fl}</td>
                                  <td className="p-2 text-right"><Input type="number" className="w-24 text-right" value={pp.selling_price || 0} onChange={(e) => setPrice(cat, fl, "selling_price", e.target.value)} /></td>
                                  <td className="p-2 text-right"><Input type="number" className="w-24 text-right" value={pp.mrp || 0} onChange={(e) => setPrice(cat, fl, "mrp", e.target.value)} /></td>
                                </tr>
                              );
                              })}
                              </Fragment>
                              ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save}>Save Customer</Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}