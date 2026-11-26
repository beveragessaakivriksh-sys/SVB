import { db } from "@/api/db";

import { useEffect, useMemo, useRef, useState } from "react";

import PageShell from "@/components/PageShell";
import HotelCombobox from "@/components/HotelCombobox";
import { Stepper } from "@/components/Stepper";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { todayISO } from "@/lib/constants";
import { itemBottles, itemAmount, computeBillTotals, getProductPrice, buildItemsFromProductList, sortCustomersAlpha } from "@/lib/billUtils";
import { useProducts } from "@/lib/useProducts";
import { nextInvoiceNumber, nextDistributorInvoiceNumber } from "@/lib/invoiceSeries";
import { distributorNameOf, isDistributorParty, partyDisplayName, partyName, resolveParty, sortPartiesAlpha, withDistributorLabel } from "@/lib/partyUtils";
import { cloneToTodayOrder } from "@/lib/cloneOrder";
import { buildOrdersSummaryPdf, printPdfDirect } from "@/lib/summaryPdf";
import { findOrderBill, deleteOrderCascade } from "@/lib/deleteOrder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ListChecks, Truck, FileDown, Pencil, Printer, Copy, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

// One independent Orders section. The page renders two of these — customer
// orders and distributor orders — so each has its own filters, selection,
// summary, clone, dispatch, modify, delete and PDF options.
function OrderSection({ kind, orders, bills, deliveries, customersById, distributorsById, distributorHotelsById, partyOptions, load, categories, flavoursByCategory, productList, readOnly = false }) {
  const user = useCurrentUser();
  const { toast } = useToast();
  const isPendingSection = kind === "pending";
  const [specificDate, setSpecificDate] = useState("");
  // Pending section starts with no date filter so it really shows ALL pending
  // orders, including older ones.
  const [from, setFrom] = useState(isPendingSection ? "" : todayISO());
  const [to, setTo] = useState(isPendingSection ? "" : todayISO());
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

  const isDistributorSection = kind === "distributor";
  const sectionLabel = isPendingSection ? "Pending" : isDistributorSection ? "Distributor" : "Customer";
  const partyOf = (order) => resolveParty(order, customersById, distributorsById, distributorHotelsById);

  const sectionOrders = useMemo(() => {
    // Pending section mixes customer + distributor orders that are not yet
    // dispatched. The other two sections keep their party split.
    let list = isPendingSection
      ? orders.filter((o) => o.dispatch_status !== "dispatched")
      : orders.filter((o) => isDistributorParty(o) === isDistributorSection);
    // A distributor account may only view its own orders — read-only.
    if (readOnly && user?.role === "distributor" && user?.distributor_id) {
      list = list.filter(
        (o) => o.distributor_id === user.distributor_id || distributorHotelsById[o.distributor_hotel_id]?.distributor_id === user.distributor_id
      );
    }
    return list;
  }, [orders, isPendingSection, isDistributorSection, readOnly, user?.role, user?.distributor_id, distributorHotelsById]);

  // Orders that already share a bill (distributor hotels combined per date).
  const combinedCounts = useMemo(() => {
    const counts = {};
    sectionOrders.forEach((o) => { if (o.bill_id) counts[o.bill_id] = (counts[o.bill_id] || 0) + 1; });
    return counts;
  }, [sectionOrders]);

  const partySelected = filterCustomer !== "all";
  const filtered = useMemo(() => {
    const list = sectionOrders.filter((o) => {
      // A party picked from the dropdown shows ALL of its orders, every date.
      if (partySelected) return o.customer_id === filterCustomer || o.distributor_id === filterCustomer || o.distributor_hotel_id === filterCustomer;
      if (specificDate) return o.order_date === specificDate;
      // Empty From/To (default in the Pending section) means all dates.
      if (from && to && (o.order_date < from || o.order_date > to)) return false;
      return true;
    });
    // Newest first — today at the top, then going back in time.
    return [...list].sort(
      (a, b) => (b.order_date || "").localeCompare(a.order_date || "") || (b.created_at || "").localeCompare(a.created_at || "")
    );
  }, [sectionOrders, specificDate, from, to, filterCustomer, partySelected]);

  const toggleOrder = (id, e) => { e.stopPropagation(); setSelectedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const toggleAll = () => setSelectedIds((p) => (p.size === filtered.length ? new Set() : new Set(filtered.map((o) => o.id))));
  const allChecked = filtered.length > 0 && selectedIds.size === filtered.length;
  const summaryOrders = filtered.filter((o) => selectedIds.has(o.id));
  const openSummary = () => { if (selectedIds.size === 0) return toast({ variant: "destructive", title: "Select orders to summarize" }); setShowSummary(true); };

  // Grouped summary: category -> party -> product {crates, loose, mrp}
  const groupedSummary = useMemo(() => {
    const g = {};
    categories.forEach((cat) => (g[cat] = {}));
    summaryOrders.forEach((o) => {
      const hotel = o.display_name || partyDisplayName(partyOf(o)) || "Unknown";
      const party = partyOf(o);
      (o.items || []).forEach((it) => {
        if (!g[it.category]) g[it.category] = {};
        if (!g[it.category][hotel]) {
          const mrpField = it.category === "Goli Fizz" ? "goli_fizz_mrp" : it.category === "Goli Blast" ? "goli_blast_mrp" : "petbottle_mrp";
          g[it.category][hotel] = { mrp: Number(party?.[mrpField]) || 0, products: {} };
        }
        const p = g[it.category][hotel].products[it.flavour] || { crates: 0, loose: 0 };
        p.crates += Number(it.crates) || 0;
        p.loose += Number(it.loose) || 0;
        g[it.category][hotel].products[it.flavour] = p;
      });
    });
    return g;
  }, [summaryOrders, customersById, distributorsById, distributorHotelsById, categories]);

  // Per-party MRP summary: Goli Fizz / Goli Blast / Petbottle MRP for each party.
  const partyMrpRows = useMemo(() => {
    const map = {};
    summaryOrders.forEach((o) => {
      const hotel = o.display_name || partyDisplayName(partyOf(o)) || "Unknown";
      const party = partyOf(o);
      if (!map[hotel]) map[hotel] = { goli_fizz: 0, goli_blast: 0, petbottle: 0 };
      map[hotel].goli_fizz = Math.max(map[hotel].goli_fizz, Number(party?.goli_fizz_mrp) || 0);
      map[hotel].goli_blast = Math.max(map[hotel].goli_blast, Number(party?.goli_blast_mrp) || 0);
      map[hotel].petbottle = Math.max(map[hotel].petbottle, Number(party?.petbottle_mrp) || 0);
    });
    return Object.entries(map);
  }, [summaryOrders, customersById, distributorsById, distributorHotelsById]);

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

  const partyRowTotal = (h) => {
    let crates = 0, loose = 0;
    Object.values(h.products || {}).forEach((p) => {
      crates += Number(p.crates) || 0;
      loose += Number(p.loose) || 0;
    });
    return { crates, loose };
  };

  const categoryGrandTotal = (cat) => {
    return Object.values(flavourTotals[cat] || {}).reduce(
      (acc, t) => ({ crates: acc.crates + t.crates, loose: acc.loose + t.loose }),
      { crates: 0, loose: 0 }
    );
  };

  const saveSummaryPdf = async (mode = "save") => {
    if (summaryOrders.length === 0) return toast({ variant: "destructive", title: "Select orders to summarize" });
    try {
      const { jsPDF } = await import("jspdf");
      // Landscape A4, everything at 1.5× the old portrait size. The table
      // stays on one page where it fits and continues on a second page when
      // the selected rows/columns overflow — nothing is squeezed.
      const pdf = new jsPDF("l", "mm", "a4");
      buildOrdersSummaryPdf(pdf, {
        title: `${sectionLabel} Order Summary — ${todayISO()}`,
        categories,
        flavoursByCategory,
        groupedSummary,
        flavourTotals,
      });

      if (mode === "print") {
        printPdfDirect(pdf);
        toast({ title: "Opening print dialog (A4 landscape)" });
        return;
      }
      pdf.save(`${sectionLabel.toLowerCase()}_orders_summary_${todayISO()}.pdf`);
      toast({ title: "Summary saved as PDF", description: "A4 landscape · 1.5× print size" });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not save PDF", description: e.message });
    }
  };

  const cloneSelectedToToday = async () => {
    if (summaryOrders.length === 0) return toast({ variant: "destructive", title: "Select orders to clone" });
    if (!confirm(`Create ${summaryOrders.length} new order(s) for today (${todayISO()}) from the selected order(s)?`)) return;
    setBusy(true);
    try {
      let made = 0;
      for (const o of summaryOrders) {
        const party = partyOf(o);
        if (!party) {
          toast({ variant: "destructive", title: `Skipped ${o.internal_invoice_number}`, description: "Its customer/distributor/hotel no longer exists." });
          continue;
        }
        await cloneToTodayOrder({ customer: party, items: o.items, user });
        made += 1;
      }
      if (made > 0) {
        toast({ title: `Cloned ${made} order(s) to today` });
        setSelectedIds(new Set());
        setSpecificDate("");
        setFrom(todayISO());
        setTo(todayISO());
        load();
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Could not clone", description: e.message });
    } finally {
      setBusy(false);
    }
  };

  // Distributor hotel orders are consolidated: all hotels of the same
  // distributor dispatched on the same date share ONE bill in Bill Entries.
  // Every hotel order keeps its own delivery but points at that single bill.
  const dispatch = async (o) => {
    if (o.dispatch_status === "dispatched") {
      // unmark
      const distributorOrder = isDistributorParty(o);
      // Legacy GST customer invoices were created at incoming time, so
      // un-dispatching only clears the dispatch flag and keeps the bill.
      if (o.has_gst && o.bill_id && !distributorOrder) {
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
        // Read fresh rows: this order may belong to a combined bill shared by
        // several hotel orders dispatched one after another.
        const [freshBills, freshOrders] = await Promise.all([
          db.entities.Bill.list("-invoice_date", 1000),
          db.entities.Order.list("-order_date", 1000),
        ]);
        const bill = freshBills.find((b) => b.id === o.bill_id);
        if (bill?.delivery_status === "delivered") return toast({ variant: "destructive", title: "Cannot unmark — bill already delivered" });
        const others = freshOrders.filter((x) => x.id !== o.id && x.bill_id === o.bill_id && x.dispatch_status === "dispatched");

        if (distributorOrder && bill && others.length > 0) {
          // Keep the combined bill and remove only this hotel's line items.
          const remaining = (bill.items || []).filter((it) => it.order_id !== o.id);
          const totals = computeBillTotals(remaining, !!bill.has_gst);
          await db.entities.Bill.update(bill.id, {
            items: remaining,
            subtotal: totals.subtotal,
            tax_total: totals.tax,
            total: totals.total,
            modified_by_name: user?.email || "unknown",
          });
          const mineDeliveries = deliveries.filter(
            (d) => d.bill_id === bill.id && (d.order_id === o.id || (!d.order_id && d.distributor_hotel_id === o.distributor_hotel_id))
          );
          for (const d of mineDeliveries) await db.entities.Delivery.delete(d.id).catch(() => {});
          await db.entities.Order.update(o.id, { dispatch_status: "pending", dispatched_date: null, bill_id: null });
          setSelected({ ...o, dispatch_status: "pending", dispatched_date: null, bill_id: null });
          toast({ title: "Removed from combined bill", description: `${others.length} order(s) still linked to ${bill.invoice_number}` });
          load();
          return;
        }

        await db.entities.Bill.delete(o.bill_id).catch(() => {});
        const allDeliveries = await db.entities.Delivery.list("-delivery_date", 1000);
        for (const d of allDeliveries.filter((x) => x.bill_id === o.bill_id)) await db.entities.Delivery.delete(d.id).catch(() => {});
      }
      await db.entities.Order.update(o.id, { dispatch_status: "pending", dispatched_date: null, bill_id: null });
      setSelected({ ...o, dispatch_status: "pending", dispatched_date: null, bill_id: null });
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
      const distributorOrder = isDistributorParty(o);
      const party = partyOf(o);
      // Resolve the parent distributor even when the order is for one of its
      // hotels — the per-distributor invoice series lives on the distributor.
      const orderDistributor = distributorsById[o.distributor_id] || distributorsById[distributorHotelsById[o.distributor_hotel_id]?.distributor_id];
      const distributorLabel = orderDistributor?.display_name || orderDistributor?.distributor_name || "";
      const partyTitle = withDistributorLabel(o.customer_name || partyName(party), distributorLabel);
      const rateOf = (it) => Number(it.rate) || getProductPrice(party, it.category, it.flavour);
      // order_id tags let a combined bill be split again on un-dispatch.
      const items = (o.items || []).map((it) => ({
        ...it,
        order_id: o.id,
        order_label: partyTitle,
        rate: rateOf(it),
        amount: itemAmount({ ...it, rate: rateOf(it) }),
      }));
      const orderTotals = computeBillTotals(items, o.has_gst);

      // Find the day's existing combined bill for this distributor (fresh from
      // the DB so selecting several orders in a row keeps combining them).
      const freshBills = await db.entities.Bill.list("-invoice_date", 1000);
      let bill = distributorOrder && orderDistributor
        ? freshBills.find(
            (b) => b.party_type === "distributor" && b.distributor_id === orderDistributor.id &&
                   b.invoice_date === date && b.delivery_status !== "delivered"
          )
        : null;
      let invoiceNo = o.invoice_number;
      let seriesName = o.invoice_series;
      let billTotals = orderTotals;

      if (bill) {
        // Append this hotel's items to the one distributor bill.
        invoiceNo = bill.invoice_number;
        seriesName = bill.invoice_series;
        const hasGst = !!bill.has_gst || !!o.has_gst;
        const allItems = [...(bill.items || []), ...items];
        billTotals = computeBillTotals(allItems, hasGst);
        const hotels = [...new Set(allItems.map((it) => it.order_label).filter(Boolean))];
        bill = await db.entities.Bill.update(bill.id, {
          items: allItems,
          has_gst: hasGst,
          subtotal: billTotals.subtotal,
          tax_total: billTotals.tax,
          total: billTotals.total,
          customer_name: withDistributorLabel(hotels.join(", "), distributorLabel),
          distributor_hotel_id: null,
          modified_by_name: user?.email || "unknown",
        });
      } else {
        // Customer orders and the first distributor order of the day get a
        // new bill. Distributor orders take the dedicated per-distributor
        // invoice number; customer orders use the GST / Non-GST series.
        if (!invoiceNo) {
          const next = distributorOrder ? await nextDistributorInvoiceNumber(orderDistributor) : await nextInvoiceNumber(o.has_gst);
          invoiceNo = next.number;
          seriesName = next.seriesName;
        }
        const billData = {
          has_gst: o.has_gst,
          invoice_number: invoiceNo,
          invoice_series: seriesName,
          invoice_date: date,
          due_date: date,
          customer_id: distributorOrder ? null : o.customer_id,
          distributor_id: distributorOrder ? (o.distributor_id || orderDistributor?.id || null) : null,
          // A combined bill can cover several hotels, so it belongs to the
          // distributor rather than to one hotel.
          distributor_hotel_id: null,
          party_type: distributorOrder ? "distributor" : "customer",
          customer_name: partyTitle,
          place_of_supply: party?.place_of_supply,
          place_of_supply_state_code: party?.place_of_supply_state_code,
          gst_treatment: party?.gst_treatment,
          gstin: party?.gstin,
          billing_attention: party?.billing_attention,
          billing_address: party?.billing_address,
          billing_street2: party?.billing_street2,
          billing_city: party?.billing_city,
          billing_state: party?.billing_state,
          billing_country: party?.billing_country,
          billing_code: party?.billing_code,
          shipping_attention: party?.shipping_attention,
          shipping_address: party?.shipping_address,
          shipping_street2: party?.shipping_street2,
          shipping_city: party?.shipping_city,
          shipping_state: party?.shipping_state,
          shipping_country: party?.shipping_country,
          shipping_code: party?.shipping_code,
          payment_terms_label: party?.payment_terms_label || "Due on Receipt",
          items,
          subtotal: orderTotals.subtotal,
          tax_total: orderTotals.tax,
          total: orderTotals.total,
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
        bill = await db.entities.Bill.create(billData);
      }

      // One delivery per hotel order, all pointing at the same combined bill.
      const deliveryDate = o.delivery_date || date;
      const delivery = await db.entities.Delivery.create({
        customer_id: distributorOrder ? null : o.customer_id,
        distributor_id: distributorOrder ? o.distributor_id : null,
        distributor_hotel_id: distributorOrder ? o.distributor_hotel_id : null,
        party_type: distributorOrder ? "distributor" : "customer",
        customer_name: partyTitle,
        delivery_date: deliveryDate,
        payment_status: "pending",
        items,
        order_id: o.id,
        returned_crates: 0,
        damaged_bottles: 0,
        total_bottles: items.reduce((s, it) => s + itemBottles(it), 0),
        total_amount: orderTotals.total,
        bill_id: bill.id,
      });
      await db.entities.Order.update(o.id, { dispatch_status: "dispatched", dispatched_date: date, bill_id: bill.id, invoice_number: invoiceNo, invoice_series: seriesName });
      setSelected({ ...o, dispatch_status: "dispatched", dispatched_date: date, bill_id: bill.id, delivery_id: delivery.id, invoice_number: invoiceNo, invoice_series: seriesName });
      toast({
        title: "Dispatched",
        description: distributorOrder
          ? `Added to combined distributor invoice ${invoiceNo} in Bill Entries`
          : `Invoice ${invoiceNo} created in Bill Entries`,
      });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setBusy(false);
    }
  };

  // Dispatch every selected pending order in one go — distributor orders of
  // the same date automatically merge into a single Bill Entries invoice.
  const dispatchSelectedTogether = async () => {
    const pending = summaryOrders.filter((x) => x.dispatch_status !== "dispatched");
    if (pending.length === 0) return toast({ variant: "destructive", title: "Select pending orders to dispatch" });
    if (!confirm(`Dispatch ${pending.length} order(s)? Distributor orders for the same date will be combined into one bill.`)) return;
    for (const order of pending) await dispatch(order);
  };

  const openModify = (o) => {
    const bill = findOrderBill(o, bills);
    const party = partyOf(o);
    const source = bill ? bill.items : o.items;
    const merged = buildItemsFromProductList(productList).map((p) => {
      const existing = (source || []).find((x) => x.category === p.category && x.flavour === p.flavour);
      return existing ? { ...p, ...existing } : { ...p, rate: getProductPrice(party, p.category, p.flavour) };
    });
    setModifyBill(bill || null);
    setModifyItems(merged);
    setModifyOpen(true);
  };

  const updateModifyItem = (idx, field, value) => {
    setModifyItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const modifyActiveItems = modifyItems.filter((it) => Number(it.crates) > 0 || Number(it.loose) > 0);
  const modifyHasGst = modifyBill ? modifyBill.has_gst : !!selected?.has_gst;
  const modifyTotals = useMemo(
    () => computeBillTotals(modifyActiveItems, modifyHasGst),
    [modifyActiveItems, modifyHasGst]
  );

  const saveModify = async () => {
    if (!selected) return;
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
      const totals = computeBillTotals(itemsWithAmount, modifyHasGst);

      if (modifyBill) {
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
      }

      if (selected?.id) {
        await db.entities.Order.update(selected.id, {
          items: itemsWithAmount,
          total_bottles: totalBottles,
          total_amount: totals.total,
        });
        setSelected((prev) => (prev ? { ...prev, items: itemsWithAmount, total_bottles: totalBottles, total_amount: totals.total } : prev));
      }

      toast({ title: modifyBill ? "Invoice updated" : "Order updated", description: `${modifyBill ? modifyBill.invoice_number : selected.internal_invoice_number} — ${itemsWithAmount.length} item(s)` });
      setModifyOpen(false);
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setModifySaving(false);
    }
  };

  const deleteOrder = async (o) => {
    const bill = findOrderBill(o, bills);
    let msg = `Delete order ${o.internal_invoice_number} (${o.display_name || o.customer_name})?`;
    if (bill) {
      msg += `\n\nThis will ALSO permanently delete invoice ${bill.invoice_number} from Bill Entries, together with its delivery and crate-return entries.`;
      if (bill.delivery_status === "delivered") msg += "\nWarning: this invoice is already marked DELIVERED.";
      if (bill.payment_status === "completed" || Number(bill.paid_amount) > 0) msg += "\nWarning: a payment is recorded on this invoice.";
      msg += "\nThe invoice number will not be reused.";
    }
    msg += "\n\nThis cannot be undone.";
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await deleteOrderCascade(o, bills, deliveries);
      toast({ title: "Order deleted", description: bill ? `${o.internal_invoice_number} and invoice ${bill.invoice_number}` : o.internal_invoice_number });
      setSelected(null);
      setSelectedIds((p) => { const n = new Set(p); n.delete(o.id); return n; });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not delete", description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const exportPdfList = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFontSize(14);
    const pdfParty = customersById[filterCustomer] || distributorsById[filterCustomer] || distributorHotelsById[filterCustomer];
    const pdfRange = partySelected ? `${partyDisplayName(pdfParty) || "Party"} — all dates` : (specificDate || (from && to ? `${from} to ${to}` : "all dates"));
    pdf.text(`${sectionLabel} Orders: ${pdfRange}`, 14, 18);
    pdf.setFontSize(9);
    let y = 28;
    pdf.text("Internal #", 14, y); pdf.text("Date", 50, y); pdf.text("Party", 80, y); pdf.text("Status", 140, y); pdf.text("Bottles", 170, y);
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
    pdf.save(`${sectionLabel.toLowerCase()}_orders_${specificDate || from || "all"}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/20 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-primary">{isPendingSection ? "Pending Orders" : isDistributorSection ? "Distributor Orders" : "Customer Orders"}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {isPendingSection
                ? "All undispatched customer and distributor orders, across all dates."
                : isDistributorSection
                  ? "Incoming orders from distributors and their hotels. Each has its own filters and options."
                  : "Incoming orders from customers/hotels. Each has its own filters and options."}
              {" "}Showing {filtered.length} of {sectionOrders.length} order(s).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!readOnly && <Button variant="outline" disabled={busy} onClick={cloneSelectedToToday}><Copy className="h-4 w-4 mr-2" /> Clone to Today</Button>}
            {!readOnly && isDistributorSection && (
              <Button variant="outline" disabled={busy} onClick={dispatchSelectedTogether}><Truck className="h-4 w-4 mr-2" /> Dispatch Selected Together</Button>
            )}
            {!readOnly && isPendingSection && (
              <Button variant="outline" disabled={busy} onClick={dispatchSelectedTogether}><Truck className="h-4 w-4 mr-2" /> Dispatch Selected</Button>
            )}
            <Button variant="outline" onClick={exportPdfList}><FileDown className="h-4 w-4 mr-2" /> PDF</Button>
            <Button onClick={openSummary}><ListChecks className="h-4 w-4 mr-2" /> Summary</Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div><Label>Specific Date</Label><Input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} disabled={partySelected} /></div>
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!!specificDate || partySelected} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={!!specificDate || partySelected} /></div>
          <div>
            <Label>{isPendingSection ? "Customer / Distributor" : isDistributorSection ? "Distributor / Hotel" : "Customer"}</Label>
            <HotelCombobox
              customers={partyOptions}
              value={filterCustomer}
              onChange={setFilterCustomer}
              allLabel={isPendingSection ? "All customers & distributors" : isDistributorSection ? "All distributors & hotels" : "All customers"}
            />
            {partySelected && <p className="mt-1 text-[11px] text-muted-foreground">Showing all dates. Choose “{isPendingSection ? "All customers & distributors" : isDistributorSection ? "All distributors & hotels" : "All customers"}” to filter by date.</p>}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-primary/20">
        <table className="w-full text-sm">
          <thead className="bg-primary/5 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3 w-10"><input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 cursor-pointer" /></th>
              <th className="p-3">Internal #</th>
              <th className="p-3">Date</th>
              {isDistributorSection && <th className="p-3">Delivery Date</th>}
              <th className="p-3">{isPendingSection ? "Customer / Distributor" : isDistributorSection ? "Distributor / Hotel" : "Customer"}</th>
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
                {isDistributorSection && <td className="p-3">{o.delivery_date || "—"}</td>}
                <td className="p-3">
                  {o.display_name || o.customer_name}
                  {isDistributorParty(o) && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Distributor</span>}
                  {combinedCounts[o.bill_id] > 1 && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800" title={`Combined with ${combinedCounts[o.bill_id] - 1} other order(s) into one bill`}>
                      Combined · {o.invoice_number}
                    </span>
                  )}
                </td>
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
            {filtered.length === 0 && <tr><td colSpan={isDistributorSection ? 9 : 8} className="p-6 text-center text-muted-foreground">No orders in this range</td></tr>}
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
                {isDistributorSection && <div><span className="text-muted-foreground">Delivery Date</span><div className="font-medium">{selected.delivery_date || "—"}</div></div>}
                <div><span className="text-muted-foreground">Party</span><div className="font-medium">{isDistributorParty(selected) ? `Distributor — ${distributorNameOf(selected, distributorsById, distributorHotelsById) || "unknown"}` : "Customer"}</div></div>
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

              {!readOnly ? (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} variant={selected.dispatch_status === "dispatched" ? "default" : "outline"} onClick={() => dispatch(selected)}>
                    <Truck className="h-4 w-4 mr-2" /> {selected.dispatch_status === "dispatched" ? "Unmark Dispatch" : "Mark Dispatched"}
                  </Button>
                  <Button variant="outline" onClick={() => openModify(selected)}>
                    <Pencil className="h-4 w-4 mr-2" /> Modify
                  </Button>
                  <Button variant="destructive" disabled={busy} onClick={() => deleteOrder(selected)}>
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Distributor access is view-only. Contact an admin to modify or dispatch orders.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modify: edit the linked invoice's line items directly from Orders */}
      <Dialog open={modifyOpen} onOpenChange={(o) => !o && setModifyOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{modifyBill ? `Modify Invoice ${modifyBill.invoice_number}` : `Modify Order ${selected?.internal_invoice_number || ""}`}</DialogTitle></DialogHeader>
          {modifyOpen && (
            <div className="max-h-[65vh] space-y-4 overflow-y-auto">
              {!modifyBill && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 text-xs text-primary">
                  This order hasn't been dispatched yet, so there is no invoice. Your changes update the order and will be used when it is dispatched.
                </div>
              )}
              {modifyBill?.delivery_status === "delivered" && (
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
                {modifyHasGst && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>₹ {modifyTotals.tax.toFixed(2)}</span></div>}
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
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-2 pr-8">
              <div>
                <DialogTitle>{sectionLabel} Order Summary — by party &amp; flavour</DialogTitle>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Print layout: A4 landscape, everything at 1.5× — one page where it fits, otherwise it flows onto a second page.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => saveSummaryPdf("print")}><Printer className="h-4 w-4 mr-1" /> Print (A4 landscape)</Button>
                <Button variant="outline" size="sm" onClick={() => saveSummaryPdf("save")}><FileDown className="h-4 w-4 mr-1" /> Save as PDF</Button>
              </div>
            </div>
          </DialogHeader>
          <div ref={summaryRef} className="max-h-[70vh] space-y-4 overflow-y-auto">
            {partyMrpRows.length > 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-primary">Party MRP</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr><th className="p-2 text-left">Party</th><th className="p-2 text-right">Goli Fizz MRP</th><th className="p-2 text-right">Goli Blast MRP</th><th className="p-2 text-right">Petbottle MRP</th></tr>
                    </thead>
                    <tbody>
                      {partyMrpRows.map(([party, m]) => (
                        <tr key={party} className="border-t border-primary/10">
                          <td className="p-2">{party}</td>
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
              const parties = Object.entries(groupedSummary[cat] || {});
              if (parties.length === 0) return null;
              const flavs = flavoursByCategory(cat);
              return (
                <div key={cat} className="rounded-xl border border-primary/20 p-3">
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-primary">{cat}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          <th rowSpan={2} className="p-2 text-left">Party</th>
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
                        {parties.map(([party, h]) => {
                          const rt = partyRowTotal(h);
                          return (
                            <tr key={party} className="border-t border-primary/10">
                              <td className="p-2">{party}</td>
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
    </div>
  );
}

// Read-only, unfiltered list of every order that has not been dispatched yet.
// Sits between Customer Orders and Distributor Orders — no filters, no sorting
// controls, no selection, no actions.
function PendingOrders({ orders, customersById, distributorsById, distributorHotelsById }) {
  const pending = useMemo(
    () => orders
      .filter((o) => o.dispatch_status !== "dispatched")
      .sort((a, b) => (b.order_date || "").localeCompare(a.order_date || "") || (b.created_at || "").localeCompare(a.created_at || "")),
    [orders]
  );

  const labelOf = (o) => {
    const party = resolveParty(o, customersById, distributorsById, distributorHotelsById);
    return withDistributorLabel(
      o.display_name || o.customer_name || partyDisplayName(party),
      distributorNameOf(o, distributorsById, distributorHotelsById)
    );
  };

  return (
    <div className="rounded-xl border border-primary/20 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-primary">Pending Orders</h2>
        <span className="text-[11px] text-muted-foreground">{pending.length} pending order(s)</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-primary/10">
        <table className="w-full text-sm">
          <thead className="bg-primary/5 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Internal #</th>
              <th className="p-3">Order Date</th>
              <th className="p-3">Delivery Date</th>
              <th className="p-3">Customer / Distributor</th>
              <th className="p-3 text-right">Bottles</th>
              <th className="p-3">Party</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((o) => (
              <tr key={o.id} className="border-t border-primary/15">
                <td className="p-3 font-medium text-primary">{o.internal_invoice_number}</td>
                <td className="p-3">{o.order_date}</td>
                <td className="p-3">{o.delivery_date || "—"}</td>
                <td className="p-3">{labelOf(o)}</td>
                <td className="p-3 text-right">{o.total_bottles || 0}</td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${isDistributorParty(o) ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {isDistributorParty(o) ? "Distributor" : "Customer"}
                  </span>
                </td>
              </tr>
            ))}
            {pending.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No pending orders</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Orders() {
  const { categories, flavoursByCategory, productList } = useProducts();
  const user = useCurrentUser();
  const isDistributorUser = user?.role === "distributor";
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [distributorHotels, setDistributorHotels] = useState([]);
  const [bills, setBills] = useState([]);
  const [deliveries, setDeliveries] = useState([]);

  // Fetch the full history once (not just the last 500) so every party's older
  // invoices stay viewable and each section can filter independently.
  const load = async () => {
    const [customerList, distributorList, hotelList] = await Promise.all([
      db.entities.Customer.list(),
      db.entities.Distributor.list(),
      db.entities.DistributorHotel.list(),
    ]);
    setCustomers(customerList);
    setDistributors(distributorList);
    setDistributorHotels(hotelList);

    const [orderList, billList, deliveryList] = await Promise.all([
      db.entities.Order.list("-order_date", 1000),
      db.entities.Bill.list("-invoice_date", 1000),
      db.entities.Delivery.list("-delivery_date", 1000),
    ]);
    setOrders(orderList);
    setBills(billList);
    setDeliveries(deliveryList);
  };
  useEffect(() => { load(); }, []);

  const customersById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);
  const distributorsById = useMemo(() => Object.fromEntries(distributors.map((d) => [d.id, d])), [distributors]);
  const distributorHotelsById = useMemo(() => Object.fromEntries(distributorHotels.map((h) => [h.id, h])), [distributorHotels]);

  const customerOptions = useMemo(() => sortCustomersAlpha(customers).map((c) => ({
    ...c,
    customer_name: c.customer_name,
    display_name: c.display_name,
  })), [customers]);

  const distributorOptions = useMemo(() => {
    const distributorRows = sortPartiesAlpha(distributors).map((d) => ({
      ...d,
      customer_name: d.distributor_name,
      display_name: `${d.display_name || d.distributor_name} · Distributor`,
    }));
    const hotelRows = sortPartiesAlpha(distributorHotels).map((h) => ({
      ...h,
      customer_name: partyName(h),
      display_name: `${partyDisplayName(h)} · ${partyDisplayName(distributorsById[h.distributor_id]) || "Distributor"}`,
    }));
    return [...distributorRows, ...hotelRows];
  }, [distributors, distributorHotels, distributorsById]);

  const sectionProps = {
    orders,
    bills,
    deliveries,
    customersById,
    distributorsById,
    distributorHotelsById,
    load,
    categories,
    flavoursByCategory,
    productList,
  };

  return (
    <PageShell
      title="Orders"
      subtitle={isDistributorUser ? "Your distributor orders (view only)" : "Customer, pending and distributor orders are shown in separate sections"}
    >
      <div className="space-y-10">
        {!isDistributorUser && (
          <>
            <OrderSection kind="customer" partyOptions={customerOptions} {...sectionProps} />
            <div className="border-t border-border pt-8">
              <PendingOrders orders={orders} customersById={customersById} distributorsById={distributorsById} distributorHotelsById={distributorHotelsById} />
            </div>
          </>
        )}
        <div className={isDistributorUser ? "" : "border-t border-border pt-8"}>
          <OrderSection kind="distributor" partyOptions={distributorOptions} readOnly={isDistributorUser} {...sectionProps} />
        </div>
      </div>
    </PageShell>
  );
}