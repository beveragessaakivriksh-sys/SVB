import { useEffect, useMemo, useState } from "react";
import { db } from "@/api/db";

import PageShell from "@/components/PageShell";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { todayISO, bottlesPerCrate, PAYMENT_MODES } from "@/lib/constants";
import { itemBottles, balanceDue } from "@/lib/billUtils";
import { printInvoiceA4, downloadInvoicePdf } from "@/lib/printUtils";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import ThermalPreview from "@/components/ThermalPreview";
import BillSummary from "@/components/BillSummary";
import { downloadCsv, buildGstZohoRows, GST_ZOHO_COLUMNS, buildNonGstRows, NON_GST_COLUMNS } from "@/lib/exportUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Printer, Copy, Pencil, FileDown, Eye, Truck, PackageCheck, ListChecks, Save, AlertTriangle, History } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function BillEntries() {
  const user = useCurrentUser();
  const { toast } = useToast();
  const [bills, setBills] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [crateEntries, setCrateEntries] = useState([]);
  const [specificDate, setSpecificDate] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showThermal, setShowThermal] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showSummary, setShowSummary] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editReturns, setEditReturns] = useState({ returned_crates: 0, damaged_bottles: 0 });
  const [editPayment, setEditPayment] = useState({ payment_status: "pending", payment_mode: "", paid_amount: 0 });

  const load = async () => {
    const all = await db.entities.Bill.list("-invoice_date", 500);
    setBills(all);
    setCustomers(await db.entities.Customer.list());
    setDeliveries(await db.entities.Delivery.list("-delivery_date", 500));
    setCrateEntries(await db.entities.CrateEntry.list("-entry_date", 500));
  };
  useEffect(() => { load(); }, []);

  const syncBillCrateEntry = async (bill) => {
    try {
      const rc = Number(bill.returned_crates) || 0;
      const damaged = Number(bill.damaged_bottles) || 0;
      const existing = await db.entities.CrateEntry.filter({ bill_id: bill.id });
      const payload = {
        customer_id: bill.customer_id,
        customer_name: bill.customer_name,
        entry_date: bill.invoice_date || todayISO(),
        crates_returned: rc,
        loose_bottles_returned: 0,
        damaged_bottles: damaged,
        bill_id: bill.id,
        source: "bill",
        notes: "Auto-synced from bill entry",
      };
      if (existing.length > 0) await db.entities.CrateEntry.update(existing[0].id, payload);
      else await db.entities.CrateEntry.create(payload);
    } catch {}
  };

  const customersById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);

  // Pending (unpaid) bills for the customer of the bill being viewed — warning banner.
  const pendingForCustomer = useMemo(() => {
    if (!selected) return [];
    return bills
      .filter((b) => b.customer_id === selected.customer_id && b.id !== selected.id && (b.payment_status || "pending") === "pending" && balanceDue(b) > 0)
      .sort((a, b) => String(b.invoice_date || "").localeCompare(String(a.invoice_date || "")));
  }, [bills, selected]);
  const pendingTotal = pendingForCustomer.reduce((s, b) => s + balanceDue(b), 0);

  const filtered = useMemo(() => {
    if (showAll) {
      return [...bills].sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
    }
    return bills.filter((b) => {
      if (specificDate) { if (b.invoice_date !== specificDate) return false; }
      else { if (b.invoice_date < from || b.invoice_date > to) return false; }
      if (filterCustomer !== "all" && b.customer_id !== filterCustomer) return false;
      return true;
    });
  }, [bills, specificDate, from, to, filterCustomer, showAll]);

  const exportGst = () => {
    const gstBills = filtered.filter((b) => b.has_gst);
    const rows = gstBills.flatMap((b) => buildGstZohoRows(b, customersById[b.customer_id]));
    if (!rows.length) return toast({ variant: "destructive", title: "No GST bills in range" });
    downloadCsv(GST_ZOHO_COLUMNS, rows, `gst_bills_${from}_to_${to}.csv`);
  };

  const exportNonGst = () => {
    const ngBills = filtered.filter((b) => !b.has_gst);
    const rows = ngBills.flatMap((b) => buildNonGstRows(b, customersById[b.customer_id]));
    if (!rows.length) return toast({ variant: "destructive", title: "No non-GST bills in range" });
    downloadCsv(NON_GST_COLUMNS, rows, `nongst_bills_${from}_to_${to}.csv`);
  };

  const exportPdfList = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFontSize(14);
    pdf.text(`Bill Entries: ${specificDate || `${from} to ${to}`}`, 14, 18);
    pdf.setFontSize(9);
    let y = 28;
    pdf.text("Inv #", 14, y); pdf.text("Date", 44, y); pdf.text("Customer", 70, y); pdf.text("Type", 130, y); pdf.text("Total", 170, y);
    y += 4;
    filtered.forEach((b) => {
      if (y > 285) { pdf.addPage(); y = 20; }
      pdf.text(String(b.invoice_number).slice(0, 14), 14, y);
      pdf.text(String(b.invoice_date), 44, y);
      pdf.text(String(b.customer_name || "").slice(0, 24), 70, y);
      pdf.text(b.has_gst ? "GST" : "Non-GST", 130, y);
      pdf.text(`Rs. ${(b.total || 0).toFixed(0)}`, 170, y);
      y += 5;
    });
    pdf.save(`bill_entries.pdf`);
  };

  const saveEdit = async () => {
    const items = editing.items.map((it) => ({
      ...it,
      crates: Number(it.crates) || 0,
      loose: Number(it.loose) || 0,
      rate: Number(it.rate) || 0,
      amount: +(((Number(it.crates) || 0) * bottlesPerCrate(it.category) + (Number(it.loose) || 0)) * (Number(it.rate) || 0)).toFixed(2),
    }));
    const subtotal = items.reduce((s, it) => s + it.amount, 0);
    const tax = editing.has_gst ? +(subtotal * 0.4).toFixed(2) : 0;
    await db.entities.Bill.update(editing.id, {
      items,
      subtotal,
      tax_total: tax,
      total: +(subtotal + tax).toFixed(2),
      returned_crates: Number(editing.returned_crates) || 0,
      damaged_bottles: Number(editing.damaged_bottles) || 0,
      payment_status: editing.payment_status,
      payment_mode: editing.payment_mode,
      paid_amount: Number(editing.paid_amount) || 0,
      modified_by_name: user?.email || "unknown",
    });
    toast({ title: "Bill updated", description: "Marked as modified by " + (user?.email || "you") });
    await syncBillCrateEntry({ ...editing, returned_crates: Number(editing.returned_crates) || 0, damaged_bottles: Number(editing.damaged_bottles) || 0 });
    setEditing(null);
    load();
  };

  const markDispatched = async (b) => {
    const already = b.dispatch_status === "dispatched";
    const patch = already ? { dispatch_status: "pending", dispatch_date: null } : { dispatch_status: "dispatched", dispatch_date: todayISO() };
    await db.entities.Bill.update(b.id, { ...patch, modified_by_name: user?.email || "unknown" });
    setSelected({ ...b, ...patch });
    toast({ title: already ? "Dispatch unmarked" : "Marked dispatched" });
    load();
  };

  const markDelivered = async (b) => {
    const already = b.delivery_status === "delivered";
    const edits = {
      payment_status: editPayment.payment_status,
      payment_mode: editPayment.payment_mode || null,
      paid_amount: Number(editPayment.paid_amount) || 0,
      returned_crates: Number(editReturns.returned_crates) || 0,
      damaged_bottles: Number(editReturns.damaged_bottles) || 0,
      modified_by_name: user?.email || "unknown",
    };
    if (already) {
      await db.entities.Bill.update(b.id, { ...edits, delivery_status: "pending", delivery_date: null });
      setSelected({ ...b, ...edits, delivery_status: "pending", delivery_date: null });
    } else {
      await db.entities.Bill.update(b.id, { ...edits, delivery_status: "delivered", delivery_date: todayISO() });
      const merged = { ...b, ...edits, delivery_status: "delivered", delivery_date: todayISO() };
      setSelected(merged);
      await syncBillCrateEntry(merged);
      setShowThermal(true);
    }
    toast({ title: already ? "Delivery unmarked" : "Marked delivered" });
    load();
  };

  const saveReturns = async () => {
    if (!selected) return;
    const rc = Number(editReturns.returned_crates) || 0;
    const damaged = Number(editReturns.damaged_bottles) || 0;
    await db.entities.Bill.update(selected.id, { returned_crates: rc, damaged_bottles: damaged, modified_by_name: user?.email || "unknown" });
    setSelected({ ...selected, returned_crates: rc, damaged_bottles: damaged });
    await syncBillCrateEntry({ ...selected, returned_crates: rc, damaged_bottles: damaged });
    toast({ title: "Returns saved on bill" });
    load();
  };

  const savePayment = async () => {
    if (!selected) return;
    const patch = {
      payment_status: editPayment.payment_status,
      payment_mode: editPayment.payment_mode || null,
      paid_amount: Number(editPayment.paid_amount) || 0,
      modified_by_name: user?.email || "unknown",
    };
    await db.entities.Bill.update(selected.id, patch);
    setSelected({ ...selected, ...patch });
    toast({ title: "Payment saved" });
    load();
  };

  const saveEntries = async () => {
    if (!selected) return;
    const patch = {
      payment_status: editPayment.payment_status,
      payment_mode: editPayment.payment_mode || null,
      paid_amount: Number(editPayment.paid_amount) || 0,
      returned_crates: Number(editReturns.returned_crates) || 0,
      damaged_bottles: Number(editReturns.damaged_bottles) || 0,
      modified_by_name: user?.email || "unknown",
    };
    await db.entities.Bill.update(selected.id, patch);
    setSelected({ ...selected, ...patch });
    await syncBillCrateEntry({ ...selected, ...patch });
    toast({ title: "Entries saved" });
    load();
  };

  const modifiedBy = (b) => (b.modified_by_name && b.modified_by_name !== b.created_by_name ? b.modified_by_name : null);

  const toggleBill = (id, e) => { e.stopPropagation(); setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const toggleAll = () => setSelectedIds((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((b) => b.id))));
  const allChecked = filtered.length > 0 && selectedIds.size === filtered.length;
  const summaryBills = filtered.filter((b) => selectedIds.has(b.id));
  const openSummary = () => { if (selectedIds.size === 0) return toast({ variant: "destructive", title: "Select bills to summarize" }); setShowSummary(true); };

  return (
    <PageShell
      title="Bill Entries"
      subtitle="View, edit, print and export invoices"
      actions={
        <>
          <Button variant="outline" onClick={exportGst}><Download className="h-4 w-4 mr-2" /> GST CSV</Button>
          <Button variant="outline" onClick={exportNonGst}><Download className="h-4 w-4 mr-2" /> Non-GST CSV</Button>
          <Button variant="outline" onClick={exportPdfList}><FileDown className="h-4 w-4 mr-2" /> PDF</Button>
          <Button variant={showAll ? "default" : "outline"} onClick={() => setShowAll(s => !s)}><History className="h-4 w-4 mr-2" /> {showAll ? "Date Range" : "Show All"}</Button>
          <Button onClick={openSummary}><ListChecks className="h-4 w-4 mr-2" /> Summary</Button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 rounded-xl border border-primary/20 bg-white p-4 sm:grid-cols-4">
        <div>
          <Label>Specific Date</Label>
          <Input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} />
          <p className="mt-1 text-[10px] text-muted-foreground">Leave empty to use range</p>
        </div>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!!specificDate} /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={!!specificDate} /></div>
        <div>
          <Label>Hotel</Label>
          <Select value={filterCustomer} onValueChange={setFilterCustomer}>
            <SelectTrigger><SelectValue placeholder="All hotels" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All hotels</SelectItem>
              {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customer_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-primary/20">
        <table className="w-full text-sm">
          <thead className="bg-primary/5 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3 w-10"><input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 cursor-pointer" /></th>
              <th className="p-3">Invoice #</th>
              <th className="p-3">Date</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Type</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3">Payment</th>
              <th className="p-3">Dispatch</th>
              <th className="p-3">Delivery</th>
              <th className="p-3">Entered / Modified by</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => {
              const mod = modifiedBy(b);
              return (
                <tr key={b.id} className="cursor-pointer border-t border-primary/15 hover:bg-primary/5" onClick={() => { setSelected(b); setShowThermal(b.delivery_status === "delivered"); setEditReturns({ returned_crates: b.returned_crates || 0, damaged_bottles: b.damaged_bottles || 0 }); setEditPayment({ payment_status: b.payment_status || "pending", payment_mode: b.payment_mode || "", paid_amount: b.paid_amount || 0 }); }}>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(b.id)} onChange={(e) => toggleBill(b.id, e)} className="h-4 w-4 cursor-pointer" />
                  </td>
                  <td className="p-3 font-medium text-primary">{b.invoice_number}</td>
                  <td className="p-3">{b.invoice_date}</td>
                  <td className="p-3">{b.customer_name}</td>
                  <td className="p-3"><span className={b.has_gst ? "text-primary" : "text-muted-foreground"}>{b.has_gst ? "GST" : "Non-GST"}</span></td>
                  <td className="p-3 text-right">₹ {(b.total || 0).toFixed(2)}</td>
                  <td className="p-3 capitalize">{b.payment_status}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${b.dispatch_status === "dispatched" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {b.dispatch_status === "dispatched" ? "Dispatched" : "Pending"}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${b.delivery_status === "delivered" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {b.delivery_status === "delivered" ? "Completed" : "Pending"}
                    </span>
                  </td>
                  <td className="p-3 text-xs">
                    <div className="text-muted-foreground">{b.created_by_name}</div>
                    {mod && <div className="text-primary">✎ Modified by {mod}</div>}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No bills in this range</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Summary + actions modal */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{selected?.invoice_number} — {selected?.customer_name}</DialogTitle></DialogHeader>
          {selected && (
            <div className="max-h-[65vh] space-y-4 overflow-y-auto">
              {pendingForCustomer.length > 0 && (
                <Alert className="border-amber-300 bg-amber-50 [&>svg]:text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle className="text-amber-900">Warning: This hotel has {pendingForCustomer.length} pending bills totaling ₹{pendingTotal.toFixed(2)}</AlertTitle>
                  <AlertDescription className="text-amber-800">
                    <ul className="mt-1 space-y-1 text-xs">
                      {pendingForCustomer.slice(0, 5).map((b) => (
                        <li key={b.id}>#{b.invoice_number} · {b.invoice_date} · ₹{balanceDue(b).toFixed(2)} due</li>
                      ))}
                      {pendingForCustomer.length > 5 && <li className="italic">+ {pendingForCustomer.length - 5} more</li>}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><span className="text-muted-foreground">Date</span><div className="font-medium">{selected.invoice_date}</div></div>
                <div><span className="text-muted-foreground">Type</span><div className="font-medium">{selected.has_gst ? "GST" : "Non-GST"}</div></div>
                <div><span className="text-muted-foreground">Total</span><div className="font-bold text-primary">₹ {(selected.total || 0).toFixed(2)}</div></div>
                <div>
                  <span className="text-muted-foreground">Payment Status</span>
                  <Select value={editPayment.payment_status} onValueChange={(v) => setEditPayment({ ...editPayment, payment_status: v })}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent>
                  </Select>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment Mode</span>
                  <Select value={editPayment.payment_mode || ""} onValueChange={(v) => setEditPayment({ ...editPayment, payment_mode: v })}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <span className="text-muted-foreground">Paid Amount</span>
                  <Input type="number" className="mt-1 h-8" value={editPayment.paid_amount} onChange={(e) => setEditPayment({ ...editPayment, paid_amount: e.target.value })} />
                </div>
                <div>
                  <span className="text-muted-foreground">Returned Crates</span>
                  <Input type="number" className="mt-1 h-8" value={editReturns.returned_crates} onChange={(e) => setEditReturns({ ...editReturns, returned_crates: e.target.value })} />
                </div>
                <div>
                  <span className="text-muted-foreground">Damaged Bottles</span>
                  <Input type="number" className="mt-1 h-8" value={editReturns.damaged_bottles} onChange={(e) => setEditReturns({ ...editReturns, damaged_bottles: e.target.value })} />
                </div>
                {selected.payment_status === "pending" && Number(selected.paid_amount) > 0 && (
                  <>
                    <div><span className="text-muted-foreground">Partial Paid</span><div className="font-medium text-amber-600">₹ {Number(selected.paid_amount).toFixed(2)}</div></div>
                    <div><span className="text-muted-foreground">Balance Due</span><div className="font-bold text-primary">₹ {Math.max(0, (selected.total || 0) - Number(selected.paid_amount)).toFixed(2)}</div></div>
                  </>
                )}
              </div>

              <div className="rounded-lg border border-primary/15 p-3">
                <div className="mb-2 text-xs font-semibold text-muted-foreground">Items</div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left">Product</th><th className="py-1">Crates</th><th className="py-1">Loose</th><th className="py-1">Bottles</th><th className="py-1 text-right">Amount</th></tr></thead>
                  <tbody>
                    {(selected.items || []).map((it, i) => (
                      <tr key={i} className="border-t border-primary/10">
                        <td className="py-1">{it.label || `${it.category} - ${it.flavour}`}</td>
                        <td className="py-1 text-center">{it.crates || 0}</td>
                        <td className="py-1 text-center">{it.loose || 0}</td>
                        <td className="py-1 text-center">{itemBottles(it)}</td>
                        <td className="py-1 text-right">₹ {(it.amount || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-primary/15 p-2">
                  <div className="text-muted-foreground">Dispatch</div>
                  <div className="font-medium text-primary">{selected.dispatch_status === "dispatched" ? `Dispatched ${selected.dispatch_date || ""}` : "Pending"}</div>
                </div>
                <div className="rounded-lg border border-primary/15 p-2">
                  <div className="text-muted-foreground">Delivery</div>
                  <div className="font-medium text-primary">{selected.delivery_status === "delivered" ? `Delivered ${selected.delivery_date || ""}` : "Pending"}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={saveEntries}><Save className="h-4 w-4 mr-1" /> Save Entries</Button>
                <Button size="sm" variant={selected.delivery_status === "delivered" ? "default" : "outline"} onClick={() => markDelivered(selected)}>
                  <PackageCheck className="h-4 w-4 mr-1" /> {selected.delivery_status === "delivered" ? "Unmark Delivered" : "Mark Delivered"}
                </Button>
              </div>

              <div className="text-[11px] text-muted-foreground">
                Entered by {selected.created_by_name}{modifiedBy(selected) ? ` · ✎ Modified by ${modifiedBy(selected)}` : ""}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Button variant="outline" size="sm" onClick={() => { setEditing(selected); setSelected(null); }}><Pencil className="h-4 w-4 mr-2" /> Modify</Button>
                <Button variant="outline" size="sm" onClick={() => printInvoiceA4(selected, customersById[selected.customer_id])}><Printer className="h-4 w-4 mr-2" /> Print A4</Button>
                <Button variant="outline" size="sm" onClick={() => printInvoiceA4(selected, customersById[selected.customer_id], { duplicate: true })}><Copy className="h-4 w-4 mr-2" /> A4 Duplicate</Button>
                <Button variant="outline" size="sm" onClick={() => downloadInvoicePdf(selected, customersById[selected.customer_id])}><FileDown className="h-4 w-4 mr-2" /> PDF</Button>
              </div>

              {selected.delivery_status === "delivered" && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="mb-2 text-xs font-semibold text-primary">Thermal Print (3 inch) — Original &amp; Duplicate · Bluetooth &amp; USB</div>
                  <ThermalPreview
                    bill={selected}
                    customer={customersById[selected.customer_id]}
                    stockContext={{ bills, crateEntries }}
                    onPrintError={(e) => toast({ variant: "destructive", title: "Print failed", description: e.message })}
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit modal */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Modify {editing?.invoice_number}</DialogTitle></DialogHeader>
          {editing && (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Payment Status</Label>
                  <Select value={editing.payment_status} onValueChange={(v) => setEditing({ ...editing, payment_status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="completed">Completed</SelectItem><SelectItem value="pending">Pending</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Payment Mode</Label>
                  <Input value={editing.payment_mode || ""} onChange={(e) => setEditing({ ...editing, payment_mode: e.target.value })} />
                </div>
                <div><Label>Paid Amount</Label><Input type="number" value={editing.paid_amount || 0} onChange={(e) => setEditing({ ...editing, paid_amount: e.target.value })} /></div>
                <div><Label>Returned Crates</Label><Input type="number" value={editing.returned_crates || 0} onChange={(e) => setEditing({ ...editing, returned_crates: e.target.value })} /></div>
                <div><Label>Damaged Bottles</Label><Input type="number" value={editing.damaged_bottles || 0} onChange={(e) => setEditing({ ...editing, damaged_bottles: e.target.value })} /></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground"><tr><th className="p-2 text-left">Item</th><th className="p-2">Crates</th><th className="p-2">Loose</th><th className="p-2">Rate</th></tr></thead>
                  <tbody>
                    {editing.items.map((it, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{it.label}</td>
                        <td className="p-2"><Input type="number" className="w-16 text-center" value={it.crates} onChange={(e) => { const items = [...editing.items]; items[i] = { ...it, crates: e.target.value }; setEditing({ ...editing, items }); }} /></td>
                        <td className="p-2"><Input type="number" className="w-16 text-center" value={it.loose} onChange={(e) => { const items = [...editing.items]; items[i] = { ...it, loose: e.target.value }; setEditing({ ...editing, items }); }} /></td>
                        <td className="p-2"><Input type="number" className="w-20 text-right" value={it.rate} onChange={(e) => { const items = [...editing.items]; items[i] = { ...it, rate: e.target.value }; setEditing({ ...editing, items }); }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button onClick={saveEdit}>Save Changes</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Summary dialog */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Production Summary</DialogTitle></DialogHeader>
          <BillSummary bills={summaryBills} />
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}