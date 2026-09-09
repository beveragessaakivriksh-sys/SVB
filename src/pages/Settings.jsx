import { db } from "@/api/db";

import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";
import PageShell from "@/components/PageShell";
import { CATEGORIES, FLAVOURS } from "@/lib/constants";
import { padNumber } from "@/lib/billUtils";
import { DEFAULT_SERIES } from "@/lib/invoiceSeries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Save, Database, Pencil, Check, X } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function Settings() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [series, setSeries] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [newProd, setNewProd] = useState({ category: "Goli Fizz", flavour: "" });
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState({ category: "Goli Fizz", flavour: "" });

  const load = async () => {
    setProducts(await db.entities.Product.list());
    const s = await db.entities.InvoiceSeries.list();
    setSeries(s);
    setDrafts(Object.fromEntries(s.map((x) => [x.id, {
      prefix: x.prefix || "",
      series_name: x.series_name || "",
      next_number: Number(x.next_number) || 1,
      padding: Number(x.padding) || 0,
    }])));
  };
  useEffect(() => { load(); }, []);

  const addProduct = async () => {
    const flavour = (newProd.flavour || "").trim();
    if (!flavour) return toast({ variant: "destructive", title: "Enter a flavour name" });
    const exists = products.some((p) => p.category === newProd.category && p.flavour.toLowerCase() === flavour.toLowerCase());
    if (exists) return toast({ variant: "destructive", title: "Product already exists" });
    await db.entities.Product.create({ category: newProd.category, flavour, is_active: true, sort_order: products.length });
    toast({ title: "Product added", description: `${newProd.category} - ${flavour}` });
    setNewProd({ ...newProd, flavour: "" });
    load();
  };

  const startEdit = (p) => { setEditingId(p.id); setEditValue({ category: p.category, flavour: p.flavour }); };
  const cancelEdit = () => { setEditingId(null); setEditValue({ category: "Goli Fizz", flavour: "" }); };

  const saveEdit = async () => {
    const p = products.find((x) => x.id === editingId);
    if (!p) return cancelEdit();
    const flavour = (editValue.flavour || "").trim();
    if (!flavour) return toast({ variant: "destructive", title: "Flavour name required" });
    if (p.category === editValue.category && p.flavour === flavour) return cancelEdit();
    const dup = products.some((x) => x.id !== p.id && x.category === editValue.category && x.flavour.toLowerCase() === flavour.toLowerCase());
    if (dup) return toast({ variant: "destructive", title: "Another product already uses that name" });
    await db.entities.Product.update(p.id, { category: editValue.category, flavour });
    toast({ title: "Product updated", description: `${editValue.category} - ${flavour}` });
    cancelEdit();
    load();
  };

  const toggleProduct = async (p) => {
    await db.entities.Product.update(p.id, { is_active: !p.is_active });
    load();
  };

  const removeProduct = async (p) => {
    if (!confirm(`Delete ${p.category} - ${p.flavour}?`)) return;
    await db.entities.Product.delete(p.id);
    load();
  };

  const setDraft = (id, field, value) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const saveSeries = async (s) => {
    const d = drafts[s.id];
    if (!d?.prefix) return toast({ variant: "destructive", title: "Enter a prefix (e.g. INV-)" });
    await db.entities.InvoiceSeries.update(s.id, {
      prefix: d.prefix,
      series_name: d.series_name,
      next_number: Number(d.next_number) || 1,
      padding: Number(d.padding) || 0,
    });
    toast({ title: "Invoice series saved", description: `Next invoice: ${d.prefix}${padNumber(Number(d.next_number) || 1, Number(d.padding) || 4)}` });
    load();
  };

  const addSeries = async (type) => {
    await db.entities.InvoiceSeries.create({ ...DEFAULT_SERIES[type] });
    toast({ title: "Invoice series created", description: `${DEFAULT_SERIES[type].prefix}${DEFAULT_SERIES[type].next_number}` });
    load();
  };

  const clearData = async (entity) => {
    if (!confirm(`Delete ALL ${entity} records? This cannot be undone.`)) return;
    await db.entities[entity].deleteMany({});
    toast({ title: `${entity} cleared` });
    load();
  };

  const deleteAccount = async () => {
    if (!confirm("Delete your account? This will wipe local credentials and sign you out. This action is irreversible.")) return;
    if (!confirm("Are you absolutely sure? This cannot be undone.")) return;
    try {
      localStorage.clear();
      sessionStorage.clear();
      await db.auth.logout();
      navigate("/login", { replace: true });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  return (
    <PageShell title="Settings" subtitle="Products, invoice series and data management">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Products — type, add, modify, delete */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-1 text-sm font-semibold">Products</h3>
          <p className="mb-3 text-[11px] text-muted-foreground">Type a flavour name to add it. Changes are reflected across the whole app.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            <Select value={newProd.category} onValueChange={(v) => setNewProd({ ...newProd, category: v })}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <Input
              className="w-40"
              placeholder="Flavour name (e.g. Orange)"
              value={newProd.flavour}
              list="flavour-suggestions"
              onChange={(e) => setNewProd({ ...newProd, flavour: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProduct(); } }}
            />
            <datalist id="flavour-suggestions">{FLAVOURS.map((f) => <option key={f} value={f} />)}</datalist>
            <Button onClick={addProduct}><Plus className="h-4 w-4 mr-1" /> Add</Button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {products.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-t border-border py-2 text-sm">
                {editingId === p.id ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <Select value={editValue.category} onValueChange={(v) => setEditValue({ ...editValue, category: v })}>
                      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="h-8 w-40" value={editValue.flavour} onChange={(e) => setEditValue({ ...editValue, flavour: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }} />
                    <div className="flex items-center gap-1">
                      <Button size="icon" className="h-8 w-8" onClick={saveEdit}><Check className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={cancelEdit}><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span>{p.category} - {p.flavour}</span>
                    <div className="flex items-center gap-3">
                      <Switch checked={p.is_active} onCheckedChange={() => toggleProduct(p)} />
                      <button onClick={() => startEdit(p)} className="text-muted-foreground hover:text-primary" title="Modify"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => removeProduct(p)} className="text-muted-foreground hover:text-destructive" title="Delete"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {products.length === 0 && <div className="py-4 text-center text-sm text-muted-foreground">No products yet — add your first above.</div>}
          </div>
        </div>

        {/* Invoice Series */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-1 text-sm font-semibold">Invoice Series</h3>
          <p className="mb-3 text-[11px] text-muted-foreground">Set the invoice prefix and current bill number. The counter auto-increments on each new bill.</p>
          {series.map((s) => {
            const d = drafts[s.id] || { prefix: s.prefix, series_name: s.series_name, next_number: s.next_number, padding: s.padding };
            return (
              <div key={s.id} className="mb-3 rounded-lg border border-border p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{s.type === "gst" ? "GST Customers" : "Non-GST Customers"}</div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <div><Label className="text-xs">Prefix</Label><Input value={d.prefix} onChange={(e) => setDraft(s.id, "prefix", e.target.value)} /></div>
                  <div><Label className="text-xs">Series Name</Label><Input value={d.series_name} onChange={(e) => setDraft(s.id, "series_name", e.target.value)} /></div>
                  <div><Label className="text-xs">Next Number</Label><Input type="number" value={d.next_number} onChange={(e) => setDraft(s.id, "next_number", e.target.value)} /></div>
                  <div><Label className="text-xs">Padding</Label><Input type="number" value={d.padding} onChange={(e) => setDraft(s.id, "padding", e.target.value)} /></div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">Next invoice: <strong>{d.prefix}{padNumber(Number(d.next_number) || 1, Number(d.padding) || 4)}</strong></div>
                  <Button size="sm" onClick={() => saveSeries(s)}><Save className="h-4 w-4 mr-1" /> Save</Button>
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            {["gst", "non_gst"].filter((t) => !series.some((s) => s.type === t)).map((t) => (
              <Button key={t} size="sm" variant="outline" onClick={() => addSeries(t)}>
                <Plus className="h-4 w-4 mr-1" /> Add {t === "gst" ? "GST" : "Non-GST"} series ({DEFAULT_SERIES[t].prefix}{DEFAULT_SERIES[t].next_number})
              </Button>
            ))}
          </div>
        </div>

        {/* Data management */}
        <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" /> Data Management</h3>
          <div className="flex flex-wrap gap-2">
            {["Bill", "Delivery", "CrateEntry", "DailyProduction", "Customer", "Product", "InvoiceSeries", "Order", "DailySummary"].map((e) => (
              <Button key={e} variant="outline" onClick={() => clearData(e)}><Trash2 className="h-4 w-4 mr-2" /> Clear {e}</Button>
            ))}
          </div>
        </div>
      </div>

      {/* Account settings */}
      <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <h3 className="mb-1 text-sm font-semibold text-destructive">Account Settings</h3>
        <p className="mb-3 text-xs text-muted-foreground">Permanently wipe local credentials and sign out of this device.</p>
        <Button variant="destructive" onClick={deleteAccount}><Trash2 className="h-4 w-4 mr-2" /> Delete Account</Button>
      </div>
    </PageShell>
  );
}