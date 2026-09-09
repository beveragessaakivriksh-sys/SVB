import { db } from "@/api/db";

import { Fragment, useEffect, useMemo, useState } from "react";

import PageShell from "@/components/PageShell";
import { todayISO } from "@/lib/constants";
import { itemBottles } from "@/lib/billUtils";
import { useProducts } from "@/lib/useProducts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, FileDown } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

const pkey = (cat, fl) => `${cat}|${fl}`;
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function DailyProduction() {
  const { toast } = useToast();
  const { categories, flavoursByCategory } = useProducts();
  const [date, setDate] = useState(todayISO());
  const [records, setRecords] = useState([]);
  const [orders, setOrders] = useState([]);
  const [bills, setBills] = useState([]);
  const [entries, setEntries] = useState([]);
  const [closingStock, setClosingStock] = useState([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setRecords(await db.entities.DailyProduction.list("-production_date", 200));
    setOrders(await db.entities.Order.list("-order_date", 500));
    setBills(await db.entities.Bill.list("-invoice_date", 500));
  };
  useEffect(() => { load(); }, []);

  const selected = useMemo(() => records.find((r) => r.production_date === date), [records, date]);

  useEffect(() => {
    const buildGrid = (source) =>
      categories.flatMap((cat) =>
        flavoursByCategory(cat).map((fl) => {
          const e = (source || []).find((x) => x.category === cat && x.flavour === fl);
          return { category: cat, flavour: fl, quantity: e ? e.quantity : 0 };
        })
      );
    if (selected) {
      setEntries(buildGrid(selected.entries));
      setClosingStock(buildGrid(selected.closing_stock));
    } else {
      setEntries(buildGrid([]));
      setClosingStock(buildGrid([]));
    }
  }, [selected, categories, flavoursByCategory]);

  const updateQty = (arr, set, cat, fl, val) =>
    set(arr.map((e) => (e.category === cat && e.flavour === fl ? { ...e, quantity: val } : e)));
  const total = entries.reduce((s, e) => s + (Number(e.quantity) || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      const filled = entries.filter((e) => Number(e.quantity) > 0).map((e) => ({ ...e, quantity: Number(e.quantity) }));
      const closing = closingStock.filter((e) => Number(e.quantity) > 0).map((e) => ({ ...e, quantity: Number(e.quantity) }));
      const payload = {
        production_date: date,
        entries: filled,
        closing_stock: closing,
        total_units: filled.reduce((s, e) => s + e.quantity, 0),
        notes,
      };
      if (selected) await db.entities.DailyProduction.update(selected.id, payload);
      else await db.entities.DailyProduction.create(payload);
      toast({ title: "Production saved" });
      setNotes("");
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const nextDay = addDays(date, 1);
  const orderedMap = useMemo(() => {
    const m = {};
    const add = (it) => { const k = pkey(it.category, it.flavour); m[k] = (m[k] || 0) + itemBottles(it); };
    orders.filter((o) => o.order_date === nextDay).forEach((o) => (o.items || []).forEach(add));
    bills.filter((b) => b.invoice_date === nextDay && b.has_gst).forEach((b) => (b.items || []).forEach(add));
    return m;
  }, [orders, bills, nextDay]);

  const producedMap = useMemo(() => {
    const m = {};
    const src = selected ? selected.entries : entries;
    src.forEach((e) => { m[pkey(e.category, e.flavour)] = Number(e.quantity) || 0; });
    return m;
  }, [selected, entries]);

  const closingMap = useMemo(() => {
    const m = {};
    const src = selected ? (selected.closing_stock || []) : closingStock;
    src.forEach((e) => { m[pkey(e.category, e.flavour)] = Number(e.quantity) || 0; });
    return m;
  }, [selected, closingStock]);

  const downloadPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFontSize(16); pdf.text(`Daily Production — ${date}`, 14, 18);
    pdf.setFontSize(10);
    let y = 30;
    pdf.text("Product", 14, y); pdf.text("Flavour", 70, y); pdf.text("Produced", 120, y); pdf.text("Closing", 150, y); pdf.text("Ordered", 175, y); y += 5;
    categories.forEach((cat) => flavoursByCategory(cat).forEach((fl) => {
      const k = pkey(cat, fl);
      const p = producedMap[k] || 0; const c = closingMap[k] || 0; const o = orderedMap[k] || 0;
      if (!p && !c && !o) return;
      if (y > 285) { pdf.addPage(); y = 20; }
      pdf.text(cat, 14, y); pdf.text(fl, 70, y); pdf.text(String(p), 120, y); pdf.text(String(c), 150, y); pdf.text(String(o), 175, y); y += 5;
    }));
    y += 4; pdf.text(`Total produced: ${selected ? selected.total_units : total}`, 14, y);
    pdf.save(`production_${date}.pdf`);
  };

  return (
    <PageShell
      title="Daily Production"
      subtitle="Enter evening production & factory closing stock; view available stock for the next day"
      actions={<Button variant="outline" onClick={downloadPdf}><FileDown className="h-4 w-4 mr-2" /> PDF</Button>}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Production Entry — {date}</h3>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">Product</th><th className="py-2">Flavour</th><th className="py-2 text-right">Units Ready (evening)</th></tr></thead>
              <tbody>
                {categories.map((cat) => (
                  <Fragment key={cat}>
                    <tr><td colSpan={3} className="pt-3 pb-1 text-xs font-bold uppercase text-primary">{cat}</td></tr>
                    {flavoursByCategory(cat).map((fl) => {
                      const e = entries.find((x) => x.category === cat && x.flavour === fl);
                      return (
                        <tr key={`${cat}-${fl}`} className="border-b border-border/50">
                          <td className="py-1.5">{cat}</td><td className="py-1.5">{fl}</td>
                          <td className="py-1.5 text-right"><Input type="number" min="0" value={e?.quantity ?? 0} onChange={(ev) => updateQty(entries, setEntries, cat, fl, ev.target.value)} className="w-28 text-right" /></td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Closing Stock at Factory — {date}</h3>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">Product</th><th className="py-2">Flavour</th><th className="py-2 text-right">Stock (units)</th></tr></thead>
              <tbody>
                {categories.map((cat) => (
                  <Fragment key={cat}>
                    <tr><td colSpan={3} className="pt-3 pb-1 text-xs font-bold uppercase text-primary">{cat}</td></tr>
                    {flavoursByCategory(cat).map((fl) => {
                      const e = closingStock.find((x) => x.category === cat && x.flavour === fl);
                      return (
                        <tr key={`c-${cat}-${fl}`} className="border-b border-border/50">
                          <td className="py-1.5">{cat}</td><td className="py-1.5">{fl}</td>
                          <td className="py-1.5 text-right"><Input type="number" min="0" value={e?.quantity ?? 0} onChange={(ev) => updateQty(closingStock, setClosingStock, cat, fl, ev.target.value)} className="w-28 text-right" /></td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-sm"><span className="text-muted-foreground">Total produced: </span><strong>{total}</strong></div>
            <Button disabled={saving} onClick={handleSave}><Save className="h-4 w-4 mr-2" /> Save</Button>
          </div>
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold text-primary">Available Stock for {nextDay} (next morning)</h3>
          <p className="mb-3 text-[11px] text-muted-foreground">Closing stock + produced − ordered (Incoming Orders for {nextDay})</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">Product</th><th className="p-2">Flavour</th><th className="p-2 text-right">Closing</th><th className="p-2 text-right">Produced</th><th className="p-2 text-right">Ordered</th><th className="p-2 text-right">Available</th></tr></thead>
              <tbody>
                {categories.flatMap((cat) => flavoursByCategory(cat).map((fl) => ({ cat, fl }))).map(({ cat, fl }) => {
                  const k = pkey(cat, fl);
                  const c = closingMap[k] || 0; const p = producedMap[k] || 0; const o = orderedMap[k] || 0;
                  if (!c && !p && !o) return null;
                  return (
                    <tr key={k} className="border-t border-primary/10">
                      <td className="p-2">{cat}</td><td className="p-2">{fl}</td>
                      <td className="p-2 text-right">{c}</td><td className="p-2 text-right">{p}</td><td className="p-2 text-right">{o}</td>
                      <td className="p-2 text-right font-semibold text-primary">{Math.max(0, c + p - o)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-border lg:col-span-2">
          <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-semibold">All Days</div>
          <div className="max-h-60 overflow-y-auto">
            {records.map((r) => (
              <div key={r.id} className="flex cursor-pointer justify-between border-t border-border px-4 py-2 text-sm hover:bg-accent/40" onClick={() => setDate(r.production_date)}>
                <span>{r.production_date}</span><span className="font-medium">{r.total_units} units</span>
              </div>
            ))}
            {records.length === 0 && <div className="p-4 text-center text-sm text-muted-foreground">No records</div>}
          </div>
        </div>
      </div>
    </PageShell>
  );
}