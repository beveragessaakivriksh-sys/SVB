import { db } from "@/api/db";

import { Fragment, useEffect, useMemo, useState } from "react";

import { priceKey } from "@/lib/constants";
import { distributorClosingStock, partyName, sortPartiesAlpha } from "@/lib/partyUtils";
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
  hotel_name: "", display_name: "", has_gst: false, place_of_supply: "", place_of_supply_state_code: "", gst_treatment: "", gstin: "",
  billing_attention: "", billing_address: "", billing_street2: "", billing_city: "", billing_state: "", billing_country: "India", billing_code: "",
  shipping_attention: "", shipping_address: "", shipping_street2: "", shipping_city: "", shipping_state: "", shipping_country: "India", shipping_code: "",
  goli_fizz_mrp: 0, goli_blast_mrp: 0, petbottle_mrp: 0, payment_terms_label: "Due on Receipt", closing_stock_crates: 0, closing_stock_loose: 0, product_prices: {}, notes: "",
};

// Hotels belong to one distributor. They are managed inside the Distributors
// tab but have the same GST/address/pricing shape as a customer, so they can
// be used directly as the bill-to party of a distributor order.
export default function DistributorHotels({ distributor, open, onClose, onChanged }) {
  const { toast } = useToast();
  const { categories, flavoursByCategory } = useProducts();
  const [hotels, setHotels] = useState([]);
  const [bills, setBills] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    if (!distributor?.id) return;
    const [list, billList] = await Promise.all([
      db.entities.DistributorHotel.filter({ distributor_id: distributor.id }, "hotel_name"),
      db.entities.Bill.list("-invoice_date", 500),
    ]);
    setHotels(sortPartiesAlpha(list));
    setBills(billList);
  };

  useEffect(() => { if (open) load(); }, [open, distributor?.id]);

  const stockMap = useMemo(() => {
    const m = {};
    hotels.forEach((h) => { m[h.id] = distributorClosingStock(h, bills); });
    return m;
  }, [hotels, bills]);

  const openNew = () => setEditing({ ...EMPTY, product_prices: {} });
  const openEdit = (h) => setEditing({ ...h, product_prices: h.product_prices || {} });

  const save = async () => {
    if (!editing.hotel_name) return toast({ variant: "destructive", title: "Hotel name required" });
    try {
      const payload = { ...editing, distributor_id: distributor.id };
      if (editing.id) await db.entities.DistributorHotel.update(editing.id, payload);
      else await db.entities.DistributorHotel.create(payload);
      toast({ title: "Hotel saved" });
      setEditing(null);
      load();
      onChanged?.();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const remove = async (h) => {
    if (!confirm(`Delete ${partyName(h)}? Orders and bills for this hotel will remain but lose the hotel link.`)) return;
    try {
      await db.entities.DistributorHotel.delete(h.id);
      if (editing?.id === h.id) setEditing(null);
      toast({ title: "Hotel deleted" });
      load();
      onChanged?.();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const set = (k, v) => setEditing((p) => ({ ...p, [k]: v }));
  const setPrice = (cat, fl, field, val) => {
    const key = priceKey(cat, fl);
    const pp = { ...(editing.product_prices || {}) };
    pp[key] = { ...(pp[key] || {}), [field]: Number(val) || 0 };
    set("product_prices", pp);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hotels for {distributor?.display_name || distributor?.distributor_name}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-1">
            <Button className="w-full" onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Add Hotel</Button>
            <div className="max-h-[65vh] space-y-1 overflow-y-auto rounded-lg border border-border">
              {hotels.map((h) => (
                <div key={h.id} className={`flex items-center justify-between gap-2 border-b border-border p-2 text-sm ${editing?.id === h.id ? "bg-primary/5" : ""}`}>
                  <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(h)}>
                    <div className="truncate font-medium">{h.display_name || h.hotel_name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {h.has_gst ? "GST" : "Non-GST"} · {stockMap[h.id]?.crates ?? 0} cr / {stockMap[h.id]?.loose ?? 0} lo
                    </div>
                  </button>
                  <button onClick={() => openEdit(h)} className="text-muted-foreground hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => remove(h)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {hotels.length === 0 && <div className="p-4 text-center text-xs text-muted-foreground">No hotels yet — add one.</div>}
            </div>
          </div>

          <div className="md:col-span-2">
            {!editing ? (
              <div className="flex h-full min-h-64 items-center justify-center rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                Select a hotel to edit, or add a new one.
              </div>
            ) : (
              <Tabs defaultValue="basic">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="basic">Basic</TabsTrigger>
                  <TabsTrigger value="addresses">Addresses</TabsTrigger>
                  <TabsTrigger value="pricing">Pricing</TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="mt-3 space-y-3">
                  <div><Label>Hotel Name</Label><Input value={editing.hotel_name} onChange={(e) => set("hotel_name", e.target.value)} /></div>
                  <div><Label>Display Name (in-app only)</Label><Input value={editing.display_name || ""} onChange={(e) => set("display_name", e.target.value)} /></div>
                  <div className="flex items-center gap-2 rounded-lg border border-border p-3">
                    <Switch checked={editing.has_gst} onCheckedChange={(v) => set("has_gst", v)} />
                    <span className="text-sm">Has GST Registration</span>
                  </div>
                  {editing.has_gst && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><Label>GSTIN</Label><Input value={editing.gstin || ""} onChange={(e) => set("gstin", e.target.value)} /></div>
                      <div><Label>GST Treatment</Label><Input value={editing.gst_treatment || ""} onChange={(e) => set("gst_treatment", e.target.value)} /></div>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><Label>Place of Supply</Label><Input value={editing.place_of_supply || ""} onChange={(e) => set("place_of_supply", e.target.value)} /></div>
                    <div><Label>Place of Supply (State Code)</Label><Input value={editing.place_of_supply_state_code || ""} onChange={(e) => set("place_of_supply_state_code", e.target.value)} /></div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><Label>Payment Terms Label</Label><Input value={editing.payment_terms_label || ""} onChange={(e) => set("payment_terms_label", e.target.value)} /></div>
                    <div><Label>Closing Stock — Crates</Label><Input type="number" value={editing.closing_stock_crates || 0} onChange={(e) => set("closing_stock_crates", e.target.value)} /></div>
                    <div><Label>Closing Stock — Loose</Label><Input type="number" value={editing.closing_stock_loose || 0} onChange={(e) => set("closing_stock_loose", e.target.value)} /></div>
                  </div>
                  <div><Label>Notes</Label><Input value={editing.notes || ""} onChange={(e) => set("notes", e.target.value)} /></div>
                </TabsContent>

                <TabsContent value="addresses" className="mt-3 space-y-3">
                  {["billing", "shipping"].map((kind) => (
                    <div key={kind} className="space-y-2">
                      <div className="text-xs font-bold uppercase tracking-wide text-primary">{kind}</div>
                      {["attention", "address", "street2", "city", "state", "country", "code"].map((f) => {
                        const key = `${kind}_${f}`;
                        return (
                          <div key={key}>
                            <Label>{f.replace("street2", "Street 2").replace(/\b\w/g, (c) => c.toUpperCase())}</Label>
                            <Input value={editing[key] || ""} onChange={(e) => set(key, e.target.value)} />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="pricing" className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><Label>Goli Fizz MRP</Label><Input type="number" value={editing.goli_fizz_mrp || 0} onChange={(e) => set("goli_fizz_mrp", e.target.value)} /></div>
                    <div><Label>Goli Blast MRP</Label><Input type="number" value={editing.goli_blast_mrp || 0} onChange={(e) => set("goli_blast_mrp", e.target.value)} /></div>
                    <div><Label>Petbottle MRP</Label><Input type="number" value={editing.petbottle_mrp || 0} onChange={(e) => set("petbottle_mrp", e.target.value)} /></div>
                  </div>
                  <div className="rounded-lg border border-border">
                    <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold">Per-Product Selling Price & MRP</div>
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-muted-foreground"><tr><th className="p-2">Product</th><th className="p-2 text-right">Selling Price</th><th className="p-2 text-right">Printed MRP</th></tr></thead>
                        <tbody>
                          {categories.map((cat) => (
                            <Fragment key={cat}>
                              <tr><td colSpan={3} className="bg-muted/30 px-2 py-1 font-semibold text-primary">{cat}</td></tr>
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

            {editing && (
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={save}>Save Hotel</Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
