import { db } from "@/api/db";

import { useEffect, useMemo, useState } from "react";

import PageShell from "@/components/PageShell";
import { todayISO } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Truck, Package, IndianRupee, Boxes, FileText } from "lucide-react";

export default function Dashboard() {
  const [date, setDate] = useState(todayISO());
  const [deliveries, setDeliveries] = useState([]);
  const [crates, setCrates] = useState([]);
  const [bills, setBills] = useState([]);

  useEffect(() => {
    db.entities.Delivery.list("-delivery_date", 500).then(setDeliveries);
    db.entities.CrateEntry.list("-entry_date", 500).then(setCrates);
    db.entities.Bill.list("-invoice_date", 500).then(setBills);
  }, []);

  const day = useMemo(() => {
    const d = deliveries.filter((x) => x.delivery_date === date);
    const c = crates.filter((x) => x.entry_date === date);
    const b = bills.filter((x) => x.invoice_date === date);
    const bottlesDelivered = d.reduce((s, x) => s + (x.total_bottles || 0), 0);
    const cratesReturned = c.reduce((s, x) => s + (x.crates_returned || 0), 0);
    const damaged = c.reduce((s, x) => s + (x.damaged_bottles || 0), 0);
    const revenue = b.reduce((s, x) => s + (x.total || 0), 0);
    const collected = d.filter((x) => x.payment_status === "completed").reduce((s, x) => s + (x.total_amount || 0), 0);
    const pending = d.filter((x) => x.payment_status === "pending").length;
    return { d, c, b, bottlesDelivered, cratesReturned, damaged, revenue, collected, pending };
  }, [date, deliveries, crates, bills]);

  const cards = [
    { label: "Deliveries", value: day.d.length, icon: Truck },
    { label: "Bottles Delivered", value: day.bottlesDelivered, icon: Package },
    { label: "Crates Returned", value: day.cratesReturned, icon: Boxes },
    { label: "Damaged Bottles", value: day.damaged, icon: Package },
    { label: "Revenue (₹)", value: day.revenue.toFixed(0), icon: IndianRupee },
    { label: "Collected (₹)", value: day.collected.toFixed(0), icon: IndianRupee },
    { label: "Pending Bills", value: day.pending, icon: FileText },
    { label: "Invoices", value: day.b.length, icon: FileText },
  ];

  const downloadPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFontSize(16); pdf.text(`Dashboard — ${date}`, 14, 18);
    pdf.setFontSize(10);
    let y = 30;
    cards.forEach((c, i) => {
      if (i % 4 === 0 && i > 0) y += 8;
      const col = i % 4;
      pdf.text(`${c.label}: ${c.value}`, 14 + col * 47, y);
    });
    y += 12;
    pdf.setFontSize(12); pdf.text("Deliveries", 14, y); y += 6;
    pdf.setFontSize(9);
    day.d.forEach((x) => { pdf.text(`${x.customer_name} — ${x.total_bottles} btl — Rs.${(x.total_amount||0).toFixed(0)} — ${x.payment_status}`, 14, y); y += 5; });
    y += 4; pdf.setFontSize(12); pdf.text("Invoices", 14, y); y += 6; pdf.setFontSize(9);
    day.b.forEach((x) => { pdf.text(`${x.invoice_number} — ${x.customer_name} — Rs.${(x.total||0).toFixed(0)}`, 14, y); y += 5; });
    pdf.save(`dashboard_${date}.pdf`);
  };

  return (
    <PageShell
      title="Dashboard"
      subtitle="Live tracking for the selected date"
      actions={<Button variant="outline" onClick={downloadPdf}>Download PDF</Button>}
    >
      <div className="mb-4 max-w-[200px]">
        <Label>Date</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{c.label}</span>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-2 text-2xl font-bold">{c.value}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border">
          <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-semibold">Today's Deliveries</div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-3">Customer</th><th className="p-3 text-right">Bottles</th><th className="p-3 text-right">Amount</th><th className="p-3">Payment</th><th className="p-3 text-right">Balance</th></tr></thead>
              <tbody>
                {day.d.map((x) => (
                  <tr key={x.id} className="border-t border-border">
                    <td className="p-3">{x.customer_name}</td><td className="p-3 text-right">{x.total_bottles}</td>
                    <td className="p-3 text-right">₹ {(x.total_amount || 0).toFixed(0)}</td><td className="p-3 capitalize">{x.payment_status}</td>
                    <td className="p-3 text-right">{x.payment_status === "pending" ? `₹ ${Math.max(0, (x.total_amount || 0) - (x.paid_amount || 0)).toFixed(0)}` : "—"}</td>
                  </tr>
                ))}
                {day.d.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No deliveries</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-xl border border-border">
          <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-semibold">Today's Invoices</div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-3">Invoice #</th><th className="p-3">Customer</th><th className="p-3 text-right">Total</th></tr></thead>
              <tbody>
                {day.b.map((x) => (
                  <tr key={x.id} className="border-t border-border">
                    <td className="p-3">{x.invoice_number}</td><td className="p-3">{x.customer_name}</td><td className="p-3 text-right">₹ {(x.total || 0).toFixed(0)}</td>
                  </tr>
                ))}
                {day.b.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">No invoices</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageShell>
  );
}