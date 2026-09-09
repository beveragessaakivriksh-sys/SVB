import { db } from "@/api/db";

import { useEffect, useMemo, useState } from "react";

import PageShell from "@/components/PageShell";
import { todayISO, BOTTLES_PER_CRATE } from "@/lib/constants";
import { customerClosingStock, totalBottles } from "@/lib/billUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Save, FileDown } from "lucide-react";

export default function CratesEntries() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [bills, setBills] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [crates, setCrates] = useState(0);
  const [loose, setLoose] = useState(0);
  const [damaged, setDamaged] = useState(0);
  const [saving, setSaving] = useState(false);
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());

  const load = async () => {
    setCustomers(await db.entities.Customer.list());
    setEntries(await db.entities.CrateEntry.list("-entry_date", 200));
    setBills(await db.entities.Bill.list("-invoice_date", 500));
  };
  useEffect(() => { load(); }, []);

  const stockByCustomer = useMemo(() => {
    const map = {};
    customers.forEach((c) => {
      const cs = customerClosingStock(c, bills, entries);
      map[c.id] = { name: c.display_name || c.customer_name, delivered: 0, returned: 0, damaged: 0, crates: cs.crates, loose: cs.loose };
    });
    bills.forEach((b) => { if (map[b.customer_id]) map[b.customer_id].delivered += totalBottles(b.items || []); });
    entries.forEach((e) => { if (map[e.customer_id]) { map[e.customer_id].returned += (e.crates_returned || 0) * BOTTLES_PER_CRATE + (e.loose_bottles_returned || 0); map[e.customer_id].damaged += e.damaged_bottles || 0; } });
    return map;
  }, [customers, bills, entries]);

  const todayEntries = useMemo(() => entries.filter((e) => e.entry_date === todayISO()), [entries]);
  const entriesInRange = useMemo(
    () => entries.filter((e) => (!fromDate || e.entry_date >= fromDate) && (!toDate || e.entry_date <= toDate)),
    [entries, fromDate, toDate]
  );

  const exportStockPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFontSize(16); pdf.text("SVB - Closing Stock (All Hotels)", 14, 18);
    pdf.setFontSize(10); pdf.text(`As on ${todayISO()}`, 14, 26);
    pdf.setFontSize(9);
    let y = 36;
    pdf.text("Hotel", 14, y); pdf.text("Delivered", 100, y); pdf.text("Returned", 128, y); pdf.text("Damaged", 150, y); pdf.text("Cl Cr", 172, y); pdf.text("Cl Loose", 185, y);
    y += 6;
    Object.entries(stockByCustomer).forEach(([id, m]) => {
      if (y > 285) { pdf.addPage(); y = 20; }
      pdf.text(String(m.name).slice(0, 24), 14, y);
      pdf.text(String(m.delivered), 100, y);
      pdf.text(String(m.returned), 128, y);
      pdf.text(String(m.damaged), 150, y);
      pdf.text(String(m.crates), 172, y);
      pdf.text(String(m.loose), 185, y);
      y += 6;
    });
    // Entries made today — included with the closing stock report.
    y += 4;
    if (y > 270) { pdf.addPage(); y = 20; }
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11);
    pdf.text(`Crate Entries made on ${todayISO()}`, 14, y); y += 6;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
    if (todayEntries.length === 0) {
      pdf.text("No entries recorded today.", 14, y); y += 6;
    } else {
      pdf.text("Hotel", 14, y); pdf.text("Crates", 110, y); pdf.text("Loose", 132, y); pdf.text("Damaged", 152, y); pdf.text("Source", 174, y);
      y += 5;
      todayEntries.forEach((e) => {
        if (y > 285) { pdf.addPage(); y = 20; }
        pdf.text(String(e.customer_name || "").slice(0, 28), 14, y);
        pdf.text(String(e.crates_returned || 0), 110, y);
        pdf.text(String(e.loose_bottles_returned || 0), 132, y);
        pdf.text(String(e.damaged_bottles || 0), 152, y);
        pdf.text(e.source === "bill" ? "Bill" : "Manual", 174, y);
        y += 5;
      });
    }
    pdf.save(`closing_stock_${todayISO()}.pdf`);
  };

  const exportEntriesPdf = async () => {
    if (entriesInRange.length === 0) return toast({ variant: "destructive", title: "No entries in the selected range" });
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFontSize(16); pdf.text("SVB - Crate Entries Report", 14, 18);
    pdf.setFontSize(10); pdf.text(`${fromDate || "start"} to ${toDate || todayISO()}`, 14, 26);
    pdf.setFontSize(9);
    let y = 36;
    pdf.text("Date", 14, y); pdf.text("Hotel", 40, y); pdf.text("Crates", 120, y); pdf.text("Loose", 140, y); pdf.text("Damaged", 158, y); pdf.text("Source", 178, y);
    y += 6;
    entriesInRange.forEach((e) => {
      if (y > 285) { pdf.addPage(); y = 20; }
      pdf.text(String(e.entry_date || ""), 14, y);
      pdf.text(String(e.customer_name || "").slice(0, 26), 40, y);
      pdf.text(String(e.crates_returned || 0), 120, y);
      pdf.text(String(e.loose_bottles_returned || 0), 140, y);
      pdf.text(String(e.damaged_bottles || 0), 158, y);
      pdf.text(e.source === "bill" ? "Bill" : "Manual", 178, y);
      y += 6;
    });
    pdf.save(`crate_entries_${fromDate || "start"}_to_${toDate || todayISO()}.pdf`);
    toast({ title: "Entries PDF saved" });
  };

  const handleSave = async () => {
    if (!customerId) return toast({ variant: "destructive", title: "Select a hotel" });
    setSaving(true);
    try {
      const c = customers.find((x) => x.id === customerId);
      await db.entities.CrateEntry.create({
        customer_id: customerId,
        customer_name: c.customer_name,
        entry_date: date,
        crates_returned: Number(crates) || 0,
        loose_bottles_returned: Number(loose) || 0,
        damaged_bottles: Number(damaged) || 0,
      });
      toast({ title: "Crates entry saved" });
      setCrates(0); setLoose(0); setDamaged(0); setCustomerId("");
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell title="Crates Entries" subtitle="Track crate returns and live closing stock per hotel" actions={
        <>
          <Button variant="outline" onClick={exportStockPdf}><FileDown className="h-4 w-4 mr-2" /> Save Stock PDF</Button>
          <Button variant="outline" onClick={exportEntriesPdf}><FileDown className="h-4 w-4 mr-2" /> Save Entries PDF</Button>
        </>
      }>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold">New Entry</h3>
          <div className="space-y-3">
            <div>
              <Label>Hotel</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger><SelectValue placeholder="Select hotel" /></SelectTrigger>
                <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.display_name || c.customer_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><Label>Crates Returned</Label><Input type="number" min="0" value={crates} onChange={(e) => setCrates(e.target.value)} /></div>
            <div><Label>Loose Bottles Returned</Label><Input type="number" min="0" value={loose} onChange={(e) => setLoose(e.target.value)} /></div>
            <div><Label>Damaged Bottles</Label><Input type="number" min="0" value={damaged} onChange={(e) => setDamaged(e.target.value)} /></div>
            <Button className="w-full" disabled={saving} onClick={handleSave}><Save className="h-4 w-4 mr-2" /> Save Entry</Button>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-border">
            <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-semibold">Closing Stock (auto-calculated)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-3">Hotel</th><th className="p-3 text-right">Delivered</th><th className="p-3 text-right">Returned</th><th className="p-3 text-right">Damaged</th><th className="p-3 text-right">Closing Cr</th><th className="p-3 text-right">Closing Loose</th></tr></thead>
                <tbody>
                  {Object.entries(stockByCustomer).map(([id, m]) => (
                    <tr key={id} className="border-t border-border">
                      <td className="p-3">{m.name}</td>
                      <td className="p-3 text-right">{m.delivered}</td>
                      <td className="p-3 text-right">{m.returned}</td>
                      <td className="p-3 text-right">{m.damaged}</td>
                      <td className="p-3 text-right font-semibold">{m.crates}</td>
                      <td className="p-3 text-right font-semibold">{m.loose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-border">
            <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-semibold">Recent Entries</span>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">From</Label>
                  <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-36" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">To</Label>
                  <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 w-36" />
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-3">Date</th><th className="p-3">Hotel</th><th className="p-3 text-right">Crates</th><th className="p-3 text-right">Loose</th><th className="p-3 text-right">Damaged</th><th className="p-3">Source</th></tr></thead>
                <tbody>
                  {entriesInRange.slice(0, 50).map((e) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="p-3">{e.entry_date}</td><td className="p-3">{e.customer_name}</td>
                      <td className="p-3 text-right">{e.crates_returned}</td><td className="p-3 text-right">{e.loose_bottles_returned}</td><td className="p-3 text-right">{e.damaged_bottles}</td>
                      <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-[10px] ${e.source === "bill" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{e.source === "bill" ? "Bill" : "Manual"}</span></td>
                    </tr>
                  ))}
                  {entriesInRange.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No entries in the selected range</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}