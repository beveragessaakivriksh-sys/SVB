import { db } from "@/api/db";

import { Fragment, useEffect, useMemo, useState } from "react";

import PageShell from "@/components/PageShell";
import DistributorHotels from "@/components/DistributorHotels";
import { priceKey } from "@/lib/constants";
import { sortPartiesAlpha, distributorClosingStock } from "@/lib/partyUtils";
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
  distributor_name: "", display_name: "", has_gst: false, place_of_supply: "", place_of_supply_state_code: "", gst_treatment: "", gstin: "",
  billing_attention: "", billing_address: "", billing_street2: "", billing_city: "", billing_state: "", billing_country: "India", billing_code: "",
  shipping_attention: "", shipping_address: "", shipping_street2: "", shipping_city: "", shipping_state: "", shipping_country: "India", shipping_code: "",
  goli_fizz_mrp: 0, goli_blast_mrp: 0, petbottle_mrp: 0, payment_terms_label: "Due on Receipt", closing_stock_crates: 0, closing_stock_loose: 0, product_prices: {}, notes: "",
};

export default function Distributors() {
  const { toast } = useToast();
  const { categories, flavoursByCategory } = useProducts();
  const [distributors, setDistributors] = useState([]);
  const [bills, setBills] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [hotelDistributor, setHotelDistributor] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setDistributors(sortPartiesAlpha(await db.entities.Distributor.list()));
    setBills(await db.entities.Bill.list("-invoice_date", 500));
    setHotels(await db.entities.DistributorHotel.list());
  };
  useEffect(() => { load(); }, []);

  const stockMap = useMemo(() => {
    const m = {};
    distributors.forEach((d) => { m[d.id] = distributorClosingStock(d, bills); });
    return m;
  }, [distributors, bills]);

  const openNew = () => setEditing({ ...EMPTY, product_prices: {} });
  const openEdit = (d) => setEditing({ ...d, product_prices: d.product_prices || {} });

  const save = async () => {
    if (!editing.distributor_name) return toast({ variant: "destructive", title: "Name required" });
    try {
      if (editing.id) await db.entities.Distributor.update(editing.id, editing);
      else await db.entities.Distributor.create(editing);
      toast({ title: "Distributor saved" });
      setEditing(null);
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const remove = async (d) => {
    if (!confirm(`Delete ${d.distributor_name}? Its hotels, orders and bills will also be removed.`)) return;
    await db.entities.Distributor.delete(d.id);
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
    <PageShell title="Distributors" subtitle="Manage distributors, GST details, per-product pricing and their hotels" actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Add Distributor</Button>}>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="p-3">Name</th><th className="p-3">Type</th><th className="p-3">GSTIN</th><th className="p-3">Place of Supply</th><th className="p-3">Hotels</th><th className="p-3 text-right">Closing Cr</th><th className="p-3 text-right">Closing Loose</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {distributors.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="p-3 font-medium">{d.display_name || d.distributor_name}</td>
                <td className="p-3">{d.has_gst ? <span className="text-primary">GST</span> : <span className="text-muted-foreground">Non-GST</span>}</td>
                <td className="p-3 text-xs">{d.gstin || "—"}</td>
                <td className="p-3 text-xs">{d.place_of_supply_state_code || "—"}</td>
                <td className="p-3">
                  <button onClick={() => setHotelDistributor(d)} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20">
                    {hotels.filter((h) => h.distributor_id === d.id).length} hotel(s) · Manage
                  </button>
                </td>
                <td className="p-3 text-right">{stockMap[d.id]?.crates ?? 0}</td>
                <td className="p-3 text-right">{stockMap[d.id]?.loose ?? 0}</td>
                <td className="p-3 text-right">
                  <button onClick={() => openEdit(d)} className="mr-2 text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(d)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
            {distributors.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No distributors yet</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Distributor" : "Add Distributor"}</DialogTitle></DialogHeader>
          {editing && (
            <Tabs defaultValue="basic">
              <TabsList className="grid w-full grid-cols-4"><TabsTrigger value="basic">Basic</TabsTrigger><TabsTrigger value="billing">Billing</TabsTrigger><TabsTrigger value="shipping">Shipping</TabsTrigger><TabsTrigger value="pricing">Pricing</TabsTrigger></TabsList>

              <TabsContent value="basic" className="space-y-3">
                <div><Label>Distributor Name</Label><Input value={editing.distributor_name} onChange={(e) => set("distributor_name", e.target.value)} /></div>
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
            <Button onClick={save}>Save Distributor</Button>
          </div>
        </DialogContent>
      </Dialog>

      {hotelDistributor && (
        <DistributorHotels
          distributor={hotelDistributor}
          open={!!hotelDistributor}
          onClose={() => setHotelDistributor(null)}
          onChanged={load}
        />
      )}
    </PageShell>
  );
}
