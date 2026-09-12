import { db } from "@/api/db";

import { useEffect, useMemo, useRef, useState } from "react";

import PageShell from "@/components/PageShell";
import { Stepper } from "@/components/Stepper";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { todayISO } from "@/lib/constants";
import { itemBottles, itemAmount, computeBillTotals, getProductPrice, buildItemsFromProductList } from "@/lib/billUtils";
import { useProducts } from "@/lib/useProducts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ListChecks, Truck, FileDown, Pencil } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function Orders() {
  const user = useCurrentUser();
  const { toast } = useToast();
  const { categories, flavoursByCategory, productList } = useProducts();
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [bills, setBills] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [specificDate, setSpecificDate] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [selected, setSelected] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showSummary, setShowSummary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyBill, setModifyBill] = useState(null);
  const [modifyItems, setModifyItems] = useState([]);
  const [modifySaving, setModifySaving] = useState(false);
  const summaryRef = useRef(null);

  const load = async () => {
    setOrders(await db.entities.Order.list("-order_date", 500));
    setCustomers(await db.entities.Customer.list());
    setBills(await db.entities.Bill.list("-invoice_date", 500));
    setDeliveries(await db.entities.Delivery.list("-delivery_date", 500));
  };
  useEffect(() => { load(); }, []);

  const customersById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (specificDate) { if (o.order_date !== specificDate) return false; }
      else { if (o.order_date < from || o.order_date > to) return false; }
      if (filterCustomer !== "all" && o.customer_id !== filterCustomer) return false;
      return true;
    });
  }, [orders, specificDate, from, to, filterCustomer]);

  const toggleOrder = (id, e) => { e.stopPropagation(); setSelectedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const toggleAll = () => setSelectedIds((p) => (p.size === filtered.length ? new Set() : new Set(filtered.map((o) => o.id))));
  const allChecked = filtered.length > 0 && selectedIds.size === filtered.length;
  const summaryOrders = filtered.filter((o) => selectedIds.has(o.id));
  const openSummary = () => { if (selectedIds.size === 0) return toast({ variant: "destructive", title: "Select orders to summarize" }); setShowSummary(true); };

  // Grouped summary: category -> hotel -> product {crates, loose, mrp}
  const groupedSummary = useMemo(() => {
    const g = {};
    categories.forEach((cat) => (g[cat] = {}));
    summaryOrders.forEach((o) => {
      const hotel = o.display_name || o.customer_name || "Unknown";
      const cust = customersById[o.customer_id];
      (o.items || []).forEach((it) => {
        if (!g[it.category]) g[it.category] = {};
        if (!g[it.category][hotel]) {
          const mrpField = it.category === "Goli Fizz" ? "goli_fizz_mrp" : it.category === "Goli Blast" ? "goli_blast_mrp" : "petbottle_mrp";
          g[it.category][hotel] = { mrp: Number(cust?.[mrpField]) || 0, products: {} };
        }
        const p = g[it.category][hotel].products[it.flavour] || { crates: 0, loose: 0 };
        p.crates += Number(it.crates) || 0;
        p.loose += Number(it.loose) || 0;
        g[it.category][hotel].products[it.flavour] = p;
      });
    });
    return g;
  }, [summaryOrders, customersById, categories]);

  // Per-hotel MRP summary: Goli Fizz / Goli Blast / Petbottle MRP for each hotel.
  const hotelMrpRows = useMemo(() => {
    const map = {};
    summaryOrders.forEach((o) => {
      const hotel = o.display_name || o.customer_name || "Unknown";
      const cust = customersById[o.customer_id];
      if (!map[hotel]) map[hotel] = { goli_fizz: 0, goli_blast: 0, petbottle: 0 };
      map[hotel].goli_fizz = Math.max(map[hotel].goli_fizz, Number(cust?.goli_fizz_mrp) || 0);
      map[hotel].goli_blast = Math.max(map[hotel].goli_blast, Number(cust?.goli_blast_mrp) || 0);
      map[hotel].petbottle = Math.max(map[hotel].petbottle, Number(cust?.petbottle_mrp) || 0);
    });
    return Object.entries(map);
  }, [summaryOrders, customersById]);

  // Total crates & loose bottles per flavour within each category
  // (across all selected hotels) — matches the summary's Crates / Loose columns.
  const flavourTotals = useMemo(() => {
    const out = {};
    categories.forEach((cat) => {
      const totals = {};
      Object.values(groupedSummary[cat] || {}).forEach((h) => {
        Object.entries(h.products || {}).forEach(([fl, p]) => {
          const t = totals[fl] || { crates: 0, loose: 0 };
          t.crates += Number(p.crates) || 0;
          t.loose += Number(p.loose) || 0;
          totals[fl] = t;
        });
      });
      out[cat] = totals;
    });
    return out;
  }, [groupedSummary, categories]);

  // Sum across all flavours for one hotel within a category — e.g. a
  // hotel ordering 2 crates Jeera + 1 crate Ginger shows "3" crates total.
  const hotelRowTotal = (h) => {
    let crates = 0, loose = 0;
    Object.values(h.products || {}).forEach((p) => {
      crates += Number(p.crates) || 0;
      loose += Number(p.loose) || 0;
    });
    return { crates, loose };
  };

  // Grand total for a whole category (Goli Fizz / Goli Blast / Petbottle) —
  // sum of every flavour's total within that category, across all hotels.
  const categoryGrandTotal = (cat) => {
    return Object.values(flavourTotals[cat] || {}).reduce(
      (acc, t) => ({ crates: acc.crates + t.crates, loose: acc.loose + t.loose }),
      { crates: 0, loose: 0 }
    );
  };

  const saveSummaryPdf = async () => {
    if (summaryOrders.length === 0) return toast({ variant: "destructive", title: "Select orders to summarize" });
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF("p", "mm", "a4");
      pdf.setFontSize(14);
      pdf.text(`Order Summary — ${todayISO()}`, 14, 16);
      pdf.setFontSize(9);
      let y = 24;


            // Per-category tables: Crates (Cr) and Loose (Lo) per flavour, plus a
      // Total column per hotel and an overall category grand total.
      // Gridlines: a light horizontal rule under every hotel row, and a
      // vertical line at every column boundary (hotel | MRP | each flavour
      // | Total), so hotels and flavours are visually separated.
      categories.forEach((cat) => {
        const hotels = Object.entries(groupedSummary[cat] || {});
        if (hotels.length === 0) return;
        const flavs = flavoursByCategory(cat);
        const totalX = 90 + flavs.length * 14;
        const rightEdge = totalX + 14;
        const colXs = [14, 70, ...flavs.map((_, i) => 90 + i * 14), totalX, rightEdge];

        if (y > 270) { pdf.addPage(); y = 20; }
        pdf.setFont("helvetica", "bold");
        pdf.text(cat, 14, y); y += 5;
        pdf.setFont("helvetica", "normal");

        let sectionTop = y - 3;

        pdf.setFontSize(7);
        pdf.text("Hotel", 14, y);
        pdf.setFontSize(9);
        pdf.text("MRP", 70, y);
        flavs.forEach((fl, i) => pdf.text(String(fl).slice(0, 6), 90 + i * 14, y));
        pdf.text("Total", totalX, y);
        y += 4;
        flavs.forEach((fl, i) => {
          const x = 90 + i * 14;
          pdf.text("Cr", x, y); pdf.text("Lo", x + 7, y);
        });
        pdf.text("Cr", totalX, y); pdf.text("Lo", totalX + 7, y);
        y += 2;
        pdf.line(14, y, rightEdge, y);
        y += 3;

        hotels.forEach(([hotel, h]) => {
          if (y > 285) {
            colXs.forEach((x) => pdf.line(x, sectionTop, x, y - 1));
            pdf.addPage();
            y = 20;
            sectionTop = y - 2;
          }
          pdf.setFontSize(7);
          pdf.text(String(hotel), 14, y);
          pdf.setFontSize(9);
          pdf.text(`Rs. ${Number(h.mrp || 0).toFixed(0)}`, 70, y);
          flavs.forEach((fl, i) => {
            const x = 90 + i * 14;
            const p = h.products[fl];
            pdf.text(p ? String(Number(p.crates) || 0) : "-", x, y);
            pdf.text(p ? String(Number(p.loose) || 0) : "-", x + 7, y);
          });
          const rt = hotelRowTotal(h);
          pdf.setFont("helvetica", "bold");
          pdf.text(String(rt.crates), totalX, y);
          pdf.text(String(rt.loose), totalX + 7, y);
          pdf.setFont("helvetica", "normal");
          y += 3.5;
          pdf.setDrawColor(220);
          pdf.line(14, y, rightEdge, y);
          pdf.setDrawColor(0);
          y += 1.5;
        });

        // totals row (crates / loose per flavour + overall category grand total)
        if (y > 285) {
          colXs.forEach((x) => pdf.line(x, sectionTop, x, y - 1));
          pdf.addPage();
          y = 20;
          sectionTop = y - 2;
        }
        pdf.setFont("helvetica", "bold");
        pdf.text("Total Cr/Lo", 14, y);
        flavs.forEach((fl, i) => {
          const x = 90 + i * 14;
          const t = flavourTotals[cat]?.[fl] || { crates: 0, loose: 0 };
          pdf.text(String(t.crates), x, y);
          pdf.text(String(t.loose), x + 7, y);
        });
        const gt = categoryGrandTotal(cat);
        pdf.text(String(gt.crates), totalX, y);
        pdf.text(String(gt.loose), totalX + 7, y);
        pdf.setFont("helvetica", "normal");
        y += 3;
        pdf.line(14, y, rightEdge, y);
        y += 2;

        // vertical column dividers for this table (or its last page segment)
        colXs.forEach((x) => pdf.line(x, sectionTop, x, y));

        y += 6;
      });

      pdf.save(`orders_summary_${todayISO()}.pdf`);
      toast({ title: "Summary saved as PDF" });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not save PDF", description: e.message });
    }
  };

  const dispatch = async (o) => {
    if (o.dispatch_status === "dispatched") {
      // unmark
      if (o.has_gst && o.bill_id) {
        const bill = bills.find((b) => b.id === o.bill_id);
        if (bill?.delivery_status === "delivered") return toast({ variant: "destructive", title: "Cannot unmark — bill already delivered" });
        await db.entities.Bill.update(o.bill_id, { dispatch_status: "pending", dispatch_date: null, modified_by_name: user?.email || "unknown" });
        await db.entities.Order.update(o.id, { dispatch_status: "pending", dispatched_date: null });
        setSelected({ ...o, dispatch_status: "pending", dispatched_date: null });
        toast({ title: "Dispatch unmarked" });
        load();
        return;
      }
      if (o.bill_id) {
        const bill = bills.find((b) => b.id === o.bill_id);
        if (bill?.delivery_status === "delivered") return toast({ variant: "destructive", title: "Cannot unmark — bill already delivered" });
        await db.entities.Bill.delete(o.bill_id).catch(() => {});
        const dl = deliveries.find((d) => d.bill_id === o.bill_id);
        if (dl) await db.entities.Delivery.delete(dl.id).catch(() => {});
      }
      await db.entities.Order.update(o.id, { dispatch_status: "pending", dispatched_date: null, bill_id: o.has_gst ? o.bill_id : null });
      setSelected({ ...o, dispatch_status: "pending", dispatched_date: null });
      toast({ title: "Dispatch unmarked" });
      load();
      return;
    }
    setBusy(true);
    try {
      const date = todayISO();
      if (o.has_gst && o.bill_id) {
        // GST bill already created at incoming time; mark dispatched
        await db.entities.Bill.update(o.bill_id, { dispatch_status: "dispatched", dispatch_date: date, modified_by_name: user?.email || "unknown" });
        await db.entities.Order.update(o.id, { dispatch_status: "dispatched", dispatched_date: date });
        setSelected({ ...o, dispatch_status: "dispatched", dispatched_date: date });
        toast({ title: "Dispatched", description: `Invoice ${o.invoice_number} marked dispatched in Bill Entries` });
        load();
        return;
      }
      // Non-GST: create the bill + delivery now
      const customer = customersById[o.customer_id];
      const rateOf = (it) => Number(it.rate) || getProductPrice(customer, it.category, it.flavour);
      const items = (o.items || []).map((it) => ({ ...it, rate: rateOf(it), amount: itemAmount({ ...it, rate: rateOf(it) }) }));
      const totals = computeBillTotals(items, o.has_gst);
      const billData = {
        has_gst: o.has_gst,
        invoice_number: o.invoice_number,
        invoice_series: o.invoice_series,
        invoice_date: date,
        due_date: date,
        customer_id: o.customer_id,
        customer_name: o.customer_name,
        place_of_supply: customer?.place_of_supply,
        place_of_supply_state_code: customer?.place_of_supply_state_code,
        gst_treatment: customer?.gst_treatment,
        gstin: customer?.gstin,
        billing_attention: customer?.billing_attention,
        billing_address: customer?.billing_address,
        billing_street2: customer?.billing_street2,
        billing_city: customer?.billing_city,
        billing_state: customer?.billing_state,
        billing_country: customer?.billing_country,
        billing_code: customer?.billing_code,
        shipping_attention: customer?.shipping_attention,
        shipping_address: customer?.shipping_address,
        shipping_street2: customer?.shipping_street2,
        shipping_city: customer?.shipping_city,
        shipping_state: customer?.shipping_state,
        shipping_country: customer?.shipping_country,
        shipping_code: customer?.shipping_code,
        payment_terms_label: customer?.payment_terms_label || "Due on Receipt",
        items,
        subtotal: totals.subtotal,
        tax_total: totals.tax,
        total: totals.total,
        returned_crates: 0,
        damaged_bottles: 0,
        payment_status: "pending",
        paid_amount: 0,
        dispatch_status: "dispatched",
        dispatch_date: date,
        delivery_status: "pending",
        created_by_name: o.created_by_name,
        modified_by_name: user?.email || "unknown",
      };
      const bill = await db.entities.Bill.create(billData);
      const delivery = await db.entities.Delivery.create({
        customer_id: o.customer_id,
        customer_name: o.customer_name,
        delivery_date: date,
        payment_status: "pending",
        items,
        returned_crates: 0,
        damaged_bottles: 0,
        total_bottles: items.reduce((s, it) => s + itemBottles(it), 0),
        total_amount: totals.total,
        bill_id: bill.id,
      });
      await db.entities.Order.update(o.id, { dispatch_status: "dispatched", dispatched_date: date, bill_id: bill.id });
      setSelected({ ...o, dispatch_status: "dispatched", dispatched_date: date, bill_id: bill.id, delivery_id: delivery.id });
      toast({ title: "Dispatched", description: `Invoice ${o.invoice_number} created in Bill Entries` });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setBusy(false);
    }
  };

  // Modify: lets any signed-in user (not just admins) edit the actual
  // invoice line items after an order has been dispatched — opens the
  // linked Bill for editing directly from the Orders tab, instead of
  // having to separately find it in Bill Entries.
  const openModify = (o) => {
    const bill = bills.find((b) => b.id === o.bill_id) || bills.find((b) => b.invoice_number === o.invoice_number);
    if (!bill) return toast({ variant: "destructive", title: "No invoice yet", description: "Dispatch this order first to create its invoice." });
    const customer = customersById[bill.customer_id];
    const merged = buildItemsFromProductList(productList).map((p) => {
      const existing = (bill.items || []).find((x) => x.category === p.category && x.flavour === p.flavour);
      return existing ? { ...p, ...existing } : { ...p, rate: getProductPrice(customer, p.category, p.flavour) };
    });
    setModifyBill(bill);
    setModifyItems(merged);
    setModifyOpen(true);
  };

  const updateModifyItem = (idx, field, value) => {
    setModifyItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const modifyActiveItems = modifyItems.filter((it) => Number(it.crates) > 0 || Number(it.loose) > 0);
  const modifyTotals = useMemo(
    () => computeBillTotals(modifyActiveItems, modifyBill?.has_gst),
    [modifyActiveItems, modifyBill]
  );

  const saveModify = async () => {
    if (!modifyBill) return;
    if (modifyActiveItems.length === 0) return toast({ variant: "destructive", title: "Add at least one item" });
    setModifySaving(true);
    try {
      const itemsWithAmount = modifyActiveItems.map((it) => ({
        ...it,
        crates: Number(it.crates) || 0,
        loose: Number(it.loose) || 0,
        rate: Number(it.rate) || 0,
        amount: itemAmount(it),
      }));
      const totalBottles = itemsWithAmount.reduce((s, it) => s + itemBottles(it), 0);
      const totals = computeBillTotals(itemsWithAmount, modifyBill.has_gst);

      await db.entities.Bill.update(modifyBill.id, {
        items: itemsWithAmount,
        subtotal: totals.subtotal,
        tax_total: totals.tax,
        total: totals.total,
        modified_by_name: user?.email || "unknown",
      });

      const linkedDelivery = deliveries.find((d) => d.bill_id === modifyBill.id);
      if (linkedDelivery) {
        await db.entities.Delivery.update(linkedDelivery.id, {
          items: itemsWithAmount,
          total_bottles: totalBottles,
          total_amount: totals.total,
        });
      }

      if (selected?.id) {
        await db.entities.Order.update(selected.id, {
          items: itemsWithAmount,
          total_bottles: totalBottles,
          total_amount: totals.total,
        });
        setSelected((prev) => (prev ? { ...prev, items: itemsWithAmount, total_bottles: totalBottles, total_amount: totals.total } : prev));
      }

      toast({ title: "Invoice updated", description: `${modifyBill.invoice_number} — ${itemsWithAmount.length} item(s)` });
      setModifyOpen(false);
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setModifySaving(false);
    }
  };

  const exportPdfList = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFontSize(14);
    pdf.text(`Orders: ${specificDate || `${from} to ${to}`}`, 14, 18);
    pdf.setFontSize(9);
    let y = 28;
    pdf.text("Internal #", 14, y); pdf.text("Date", 50, y); pdf.text("Customer", 80, y); pdf.text("Status", 140, y); pdf.text("Bottles", 170, y);
    y += 5;
    filtered.forEach((o) => {
      if (y > 285) { pdf.addPage(); y = 20; }
      pdf.text(String(o.internal_invoice_number).slice(0, 16), 14, y);
      pdf.text(String(o.order_date), 50, y);
      pdf.text(String(o.customer_name || "").slice(0, 22), 80, y);
      pdf.text(o.dispatch_status, 140, y);
      pdf.text(String(o.total_bottles || 0), 170, y);
      y += 5;
    });
    pdf.save(`orders_${specificDate || from}.pdf`);
  };

  return (
    <PageShell
      title="Orders"
      subtitle="Internal invoices — review, summarize and dispatch to create the actual bill"
      actions={
        <>
          <Button variant="outline" onClick={exportPdfList}><FileDown className="h-4 w-4 mr-2" /> PDF</Button>
          <Button onClick={openSummary}><ListChecks className="h-4 w-4 mr-2" /> Summary</Button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 rounded-xl border border-primary/20 bg-white p-4 sm:grid-cols-4">
        <div><Label>Specific Date</Label><Input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} /></div>
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
              <th className="p-3">Internal #</th>
              <th className="p-3">Date</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Type</th>
              <th className="p-3 text-right">Bottles</th>
              <th className="p-3">Status</th>
              <th className="p-3">Entered by</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.id} className="cursor-pointer border-t border-primary/15 hover:bg-primary/5" onClick={() => setSelected(o)}>
                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(o.id)} onChange={(e) => toggleOrder(o.id, e)} className="h-4 w-4 cursor-pointer" />
                </td>
                <td className="p-3 font-medium text-primary">{o.internal_invoice_number}</td>
                <td className="p-3">{o.order_date}</td>
                <td className="p-3">{o.display_name || o.customer_name}</td>
                <td className="p-3"><span className={o.has_gst ? "text-primary" : "text-muted-foreground"}>{o.has_gst ? "GST" : "Non-GST"}</span></td>
                <td className="p-3 text-right">{o.total_bottles || 0}</td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${o.dispatch_status === "dispatched" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {o.dispatch_status === "dispatched" ? "Dispatched" : "Pending"}
                  </span>
                </td>
                <td className="p-3 text-xs text-muted-foreground">{o.created_by_name}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No orders in this range</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Order detail: summary + Mark Dispatched */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{selected?.internal_invoice_number} — {selected?.display_name || selected?.customer_name}</DialogTitle></DialogHeader>
          {selected && (
            <div className="max-h-[65vh] space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><span className="text-muted-foreground">Order Date</span><div className="font-medium">{selected.order_date}</div></div>
                <div><span className="text-muted-foreground">Type</span><div className="font-medium">{selected.has_gst ? "GST" : "Non-GST"}</div></div>
                <div><span className="text-muted-foreground">Total Bottles</span><div className="font-medium">{selected.total_bottles || 0}</div></div>
              </div>

              <div className="rounded-lg border border-primary/15 p-3">
                <div className="mb-2 text-xs font-semibold text-muted-foreground">Items</div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left">Product</th><th className="py-1">Crates</th><th className="py-1">Loose</th><th className="py-1">Bottles</th></tr></thead>
                  <tbody>
                    {(selected.items || []).map((it, i) => (
                      <tr key={i} className="border-t border-primary/10">
                        <td className="py-1">{it.label || `${it.category} - ${it.flavour}`}</td>
                        <td className="py-1 text-center">{it.crates || 0}</td>
                        <td className="py-1 text-center">{it.loose || 0}</td>
                        <td className="py-1 text-center">{itemBottles(it)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-[11px] text-muted-foreground">Entered by {selected.created_by_name}</div>

              {selected.dispatch_status === "dispatched" && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 text-xs text-primary">
                  Dispatched {selected.dispatched_date || ""} → invoice <strong>{selected.invoice_number}</strong> created in Bill Entries.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} variant={selected.dispatch_status === "dispatched" ? "default" : "outline"} onClick={() => dispatch(selected)}>
                  <Truck className="h-4 w-4 mr-2" /> {selected.dispatch_status === "dispatched" ? "Unmark Dispatch" : "Mark Dispatched"}
                </Button>
                {(selected.bill_id || selected.dispatch_status === "dispatched") && (
                  <Button variant="outline" onClick={() => openModify(selected)}>
                    <Pencil className="h-4 w-4 mr-2" /> Modify
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modify: edit the linked invoice's line items directly from Orders */}
      <Dialog open={modifyOpen} onOpenChange={(o) => !o && setModifyOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Modify Invoice {modifyBill?.invoice_number}</DialogTitle></DialogHeader>
          {modifyBill && (
            <div className="max-h-[65vh] space-y-4 overflow-y-auto">
              {modifyBill.delivery_status === "delivered" && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">
                  This invoice is already marked delivered — you can still edit it, but you may want to reprint it for the customer afterwards.
                </div>
              )}
              <div className="space-y-4">
                {categories.map((cat) => (
                  <div key={cat}>
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-primary">{cat}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {flavoursByCategory(cat).map((fl) => {
                        const idx = modifyItems.findIndex((i) => i.category === cat && i.flavour === fl);
                        const it = modifyItems[idx];
                        if (!it) return null;
                        return (
                          <div key={`${cat}-${fl}`} className="flex items-center justify-between gap-2 rounded-lg border border-primary/10 bg-primary/5 px-3 py-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{fl}</div>
                              <Input
                                type="number"
                                value={it.rate}
                                onChange={(e) => updateModifyItem(idx, "rate", e.target.value)}
                                className="mt-1 h-7 w-20 text-xs"
                              />
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-muted-foreground">Crates</span>
                                <Stepper value={it.crates} onChange={(v) => updateModifyItem(idx, "crates", v)} />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-muted-foreground">Loose</span>
                                <Stepper value={it.loose} onChange={(v) => updateModifyItem(idx, "loose", v)} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>₹ {modifyTotals.subtotal.toFixed(2)}</span></div>
                {modifyBill.has_gst && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>₹ {modifyTotals.tax.toFixed(2)}</span></div>}
                <div className="flex justify-between border-t border-primary/20 pt-2 text-base font-bold text-primary"><span>Total</span><span>₹ {modifyTotals.total.toFixed(2)}</span></div>
              </div>

              <Button disabled={modifySaving} onClick={saveModify} className="w-full">
                {modifySaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Grouped summary */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-8">
              <DialogTitle>Order Summary — by hotel & flavour</DialogTitle>
              <Button variant="outline" size="sm" onClick={saveSummaryPdf}><FileDown className="h-4 w-4 mr-1" /> Save as PDF</Button>
            </div>
          </DialogHeader>
          <div ref={summaryRef} className="max-h-[70vh] space-y-4 overflow-y-auto">
            {hotelMrpRows.length > 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-primary">Hotel MRP</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr><th className="p-2 text-left">Hotel</th><th className="p-2 text-right">Goli Fizz MRP</th><th className="p-2 text-right">Goli Blast MRP</th><th className="p-2 text-right">Petbottle MRP</th></tr>
                    </thead>
                    <tbody>
                      {hotelMrpRows.map(([hotel, m]) => (
                        <tr key={hotel} className="border-t border-primary/10">
                          <td className="p-2">{hotel}</td>
                          <td className="p-2 text-right">₹ {Number(m.goli_fizz).toFixed(0)}</td>
                          <td className="p-2 text-right">₹ {Number(m.goli_blast).toFixed(0)}</td>
                          <td className="p-2 text-right">₹ {Number(m.petbottle).toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {categories.map((cat) => {
              const hotels = Object.entries(groupedSummary[cat] || {});
              if (hotels.length === 0) return null;
              const flavs = flavoursByCategory(cat);
              return (
                <div key={cat} className="rounded-xl border border-primary/20 p-3">
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-primary">{cat}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          <th rowSpan={2} className="p-2 text-left">Hotel</th>
                          <th rowSpan={2} className="p-2 text-right">MRP</th>
                          {flavs.map((fl) => <th key={fl} colSpan={2} className="p-2 text-center">{fl}</th>)}
                          <th colSpan={2} className="p-2 text-center font-bold text-primary">Total</th>
                        </tr>
                        <tr>
                          {flavs.flatMap((fl) => [
                            <th key={`${fl}-cr`} className="p-1 text-center font-normal">Crates</th>,
                            <th key={`${fl}-lo`} className="p-1 text-center font-normal">Loose</th>,
                          ])}
                          <th className="p-1 text-center font-normal text-primary">Crates</th>
                          <th className="p-1 text-center font-normal text-primary">Loose</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hotels.map(([hotel, h]) => {
                          const rt = hotelRowTotal(h);
                          return (
                            <tr key={hotel} className="border-t border-primary/10">
                              <td className="p-2">{hotel}</td>
                              <td className="p-2 text-right">₹ {Number(h.mrp || 0).toFixed(0)}</td>
                              {flavs.flatMap((fl) => {
                                const p = h.products[fl];
                                const cr = p ? Number(p.crates) || 0 : 0;
                                const lo = p ? Number(p.loose) || 0 : 0;
                                return [
                                  <td key={`${fl}-cr`} className={`p-2 text-center ${cr ? "" : "text-muted-foreground"}`}>{cr || "—"}</td>,
                                  <td key={`${fl}-lo`} className={`p-2 text-center ${lo ? "" : "text-muted-foreground"}`}>{lo || "—"}</td>,
                                ];
                              })}
                              <td className="p-2 text-center font-semibold text-primary">{rt.crates || "—"}</td>
                              <td className="p-2 text-center font-semibold text-primary">{rt.loose || "—"}</td>
                            </tr>
                          );
                        })}
                        <tr className="border-t-2 border-primary/30 bg-primary/5 font-semibold">
                          <td className="p-2" colSpan={2}>Total (crates / loose)</td>
                          {flavs.flatMap((fl) => {
                            const t = flavourTotals[cat]?.[fl] || { crates: 0, loose: 0 };
                            return [
                              <td key={`${fl}-cr`} className="p-2 text-center text-primary">{t.crates}</td>,
                              <td key={`${fl}-lo`} className="p-2 text-center text-primary">{t.loose}</td>,
                            ];
                          })}
                          {(() => {
                            const gt = categoryGrandTotal(cat);
                            return (
                              <>
                                <td className="p-2 text-center text-primary">{gt.crates}</td>
                                <td className="p-2 text-center text-primary">{gt.loose}</td>
                              </>
                            );
                          })()}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">Each flavour shows Crates and Loose bottles. (—) when no entry.</p>
                </div>
              );
            })}
            {summaryOrders.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">No orders selected</div>}
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
