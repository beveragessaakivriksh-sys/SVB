import { db } from "@/api/db";

import { useEffect, useMemo, useState } from "react";

import PageShell from "@/components/PageShell";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { todayISO } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileDown, Save, Clock, MapPin, AlertTriangle, Crosshair } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useLocationTracker } from "@/lib/useLocationTracker";

export default function DailySummaryPage() {
  const user = useCurrentUser();
  const { toast } = useToast();
  const [date, setDate] = useState(todayISO());
  const [form, setForm] = useState({ morning_start_time: "", evening_end_time: "", morning_kms: 0, evening_kms: 0 });
  const [mine, setMine] = useState([]);
  const [bills, setBills] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.role === "admin";
  const nowTime = () => new Date().toTimeString().slice(0, 5);
  const loc = useLocationTracker({ user });

  const load = async () => {
    setMine(await db.entities.DailySummary.filter({ summary_date: todayISO() }, "-summary_date", 50));
    setBills(await db.entities.Bill.list("-invoice_date", 500));
    setCustomers(await db.entities.Customer.list());
    setSummaries(await db.entities.DailySummary.list("-summary_date", 500));
  };
  useEffect(() => { load(); }, []);

  const customersById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);

  const save = async () => {
    setSaving(true);
    try {
      const mk = Number(form.morning_kms) || 0;
      const ek = Number(form.evening_kms) || 0;
      const existing = mine.find((m) => m.summary_date === date);
      const payload = {
        summary_date: date,
        user_id: user?.id,
        user_name: user?.email,
        morning_start_time: form.morning_start_time,
        evening_end_time: form.evening_end_time,
        morning_kms: mk,
        evening_kms: ek,
        total_kms: Math.max(0, ek - mk),
      };
      if (existing) await db.entities.DailySummary.update(existing.id, payload);
      else await db.entities.DailySummary.create({ ...payload });
      toast({ title: "Daily summary saved" });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setSaving(false);
    }
  };

  // Admin day report: users active in bill entries for the chosen date
  const dayReport = useMemo(() => {
    const byUser = {};
    bills.forEach((b) => {
      if (b.invoice_date !== date) return;
      const u = b.created_by_name || "Unknown";
      byUser[u] = byUser[u] || { user: u, hotels: {} };
      const hotel = b.customer_name || customersById[b.customer_id]?.customer_name || "Unknown";
      byUser[u].hotels[hotel] = byUser[u].hotels[hotel] || { emptyCrates: 0, paymentStatus: "pending", mode: null, partial: 0, deliveredAt: null };
      byUser[u].hotels[hotel].emptyCrates += Number(b.returned_crates) || 0;
      if (b.payment_status === "completed") byUser[u].hotels[hotel].paymentStatus = "completed";
      else if (Number(b.paid_amount) > 0) byUser[u].hotels[hotel].paymentStatus = "partial";
      byUser[u].hotels[hotel].mode = b.payment_mode || byUser[u].hotels[hotel].mode;
      byUser[u].hotels[hotel].partial += Number(b.paid_amount) || 0;
      if (b.delivery_status === "delivered" && b.updated_at) byUser[u].hotels[hotel].deliveredAt = b.updated_at;
    });
    return Object.values(byUser).map((u) => {
      const ds = summaries.find((s) => s.user_name === u.user && s.summary_date === date);
      const hotelList = Object.values(u.hotels);
      return {
        ...u,
        morning_start_time: ds?.morning_start_time || "—",
        evening_end_time: ds?.evening_end_time || "—",
        total_kms: ds?.total_kms ?? "—",
        totalEmptyCrates: hotelList.reduce((s, h) => s + (h.emptyCrates || 0), 0),
        totalPartial: hotelList.reduce((s, h) => s + (h.partial || 0), 0),
      };
    });
  }, [bills, customersById, summaries, date]);

  const downloadReport = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFontSize(14);
    pdf.text(`Daily Summary — ${date}`, 14, 18);
    pdf.setFontSize(8);
    let y = 26;
    dayReport.forEach((u) => {
      if (y > 280) { pdf.addPage(); y = 16; }
      pdf.setFontSize(11);
      pdf.text(`User: ${u.user}`, 14, y); y += 6;
      pdf.setFontSize(8);
      pdf.text(`Factory leaving: ${u.morning_start_time}   Factory return: ${u.evening_end_time}   Kms: ${u.total_kms}`, 14, y); y += 5;
      pdf.text("Hotel", 14, y); pdf.text("Empty Crates", 70, y); pdf.text("Payment", 100, y); pdf.text("Mode", 125, y); pdf.text("Amount", 150, y); pdf.text("Delivery time", 170, y);
      y += 4; pdf.line(14, y, 196, y); y += 3;
      Object.entries(u.hotels).forEach(([hotel, h]) => {
        if (y > 285) { pdf.addPage(); y = 16; }
        pdf.text(String(hotel).slice(0, 20), 14, y);
        pdf.text(String(h.emptyCrates), 70, y);
        pdf.text(h.paymentStatus, 100, y);
        pdf.text(h.mode || "-", 125, y);
        pdf.text(String(h.partial || 0), 150, y);
        pdf.text(h.deliveredAt ? String(h.deliveredAt).slice(0, 16) : "-", 170, y);
        y += 5;
      });
      pdf.setFont("helvetica", "bold");
      pdf.text(`Total empty crates: ${u.totalEmptyCrates}   Amount paid: Rs.${u.totalPartial}`, 14, y); y += 5;
      pdf.setFont("helvetica", "normal");
      pdf.line(14, y, 196, y); y += 6;
    });
    pdf.save(`daily_summary_${date}.pdf`);
  };

  return (
    <PageShell title="Daily Summary" subtitle="Log your route timings and kilometres; admins download the day's consolidated report">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-primary/20 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-primary">My Route — {date}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Morning Start Time</Label>
              <Button type="button" variant="outline" className="w-full justify-between" onClick={() => setForm({ ...form, morning_start_time: nowTime() })}>
                <Clock className="h-4 w-4" /> <span>{form.morning_start_time || "Capture system time"}</span>
              </Button>
            </div>
            <div>
              <Label>Evening End Time</Label>
              <Button type="button" variant="outline" className="w-full justify-between" onClick={() => setForm({ ...form, evening_end_time: nowTime() })}>
                <Clock className="h-4 w-4" /> <span>{form.evening_end_time || "Capture system time"}</span>
              </Button>
            </div>
            <div><Label>Morning Kilometres</Label><Input type="number" value={form.morning_kms} onChange={(e) => setForm({ ...form, morning_kms: e.target.value })} /></div>
            <div><Label>Evening Kilometres</Label><Input type="number" value={form.evening_kms} onChange={(e) => setForm({ ...form, evening_kms: e.target.value })} /></div>
          </div>
          <div className="mt-3 text-sm text-muted-foreground">Total Kms: <strong className="text-foreground">{Math.max(0, (Number(form.evening_kms) || 0) - (Number(form.morning_kms) || 0))}</strong></div>
          <Button className="mt-3" disabled={saving} onClick={save}><Save className="h-4 w-4 mr-2" /> Save Summary</Button>
        </div>

        {isAdmin && (
          <div className="rounded-xl border border-primary/20 bg-white p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary"><Clock className="h-4 w-4" /> Admin — Day Report</h3>
            <div className="mb-3 flex items-end gap-2">
              <div className="flex-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <Button variant="outline" onClick={downloadReport}><FileDown className="h-4 w-4 mr-2" /> Download PDF</Button>
            </div>
            <div className="max-h-72 space-y-3 overflow-y-auto">
              {dayReport.length === 0 && <div className="py-4 text-center text-sm text-muted-foreground">No bill entries on {date}</div>}
              {dayReport.map((u) => (
                <div key={u.user} className="rounded-lg border border-primary/15 p-3">
                  <div className="text-sm font-semibold">{u.user}</div>
                  <div className="text-[11px] text-muted-foreground">Leave {u.morning_start_time} · Return {u.evening_end_time} · Kms {u.total_kms}</div>
                  <table className="mt-2 w-full text-xs">
                    <thead className="text-muted-foreground"><tr><th className="p-1 text-left">Hotel</th><th className="p-1">Crates</th><th className="p-1">Pay</th><th className="p-1">Mode</th><th className="p-1">Partial</th></tr></thead>
                    <tbody>
                      {Object.entries(u.hotels).map(([hotel, h]) => (
                        <tr key={hotel} className="border-t border-primary/10">
                          <td className="p-1">{hotel}</td>
                          <td className="p-1 text-center">{h.emptyCrates}</td>
                          <td className="p-1 text-center capitalize">{h.paymentStatus}</td>
                          <td className="p-1 text-center">{h.mode || "—"}</td>
                          <td className="p-1 text-center">{h.partial || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-1 text-[11px] text-muted-foreground">Total empty crates: <strong className="text-foreground">{u.totalEmptyCrates}</strong> · Partial paid: <strong className="text-foreground">₹{u.totalPartial}</strong></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Location access + PWA debug log */}
      <div className="mt-4 rounded-xl border border-primary/20 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-primary"><Crosshair className="h-4 w-4" /> Location Access</h3>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${loc.permission === "granted" ? "bg-primary/15 text-primary" : loc.permission === "denied" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}>{loc.permission}</span>
            <Button size="sm" onClick={loc.enable}><MapPin className="h-4 w-4 mr-1" /> Enable Location Access</Button>
            {loc.active && <Button size="sm" variant="outline" onClick={loc.stop}>Stop</Button>}
          </div>
        </div>
        {loc.error && (
          <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong>{loc.error.code}:</strong> {loc.error.message}</span>
          </div>
        )}
        {loc.coords && (
          <div className="mb-2 text-xs text-muted-foreground">
            Last fix: <strong className="text-foreground">{Number(loc.coords.latitude).toFixed(5)}, {Number(loc.coords.longitude).toFixed(5)}</strong> (±{Math.round(loc.coords.accuracy || 0)}m)
          </div>
        )}
        <div className="rounded-lg border border-border bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Debug Log</div>
          {loc.debugLog.length === 0 && <div className="text-slate-400">No events yet. Tap “Enable Location Access” to start.</div>}
          {loc.debugLog.map((e, i) => (
            <div key={i} className={e.level === "error" ? "text-red-600" : ""}>
              <span className="text-slate-400">{e.t}</span> · {e.msg}
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}