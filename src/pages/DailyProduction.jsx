import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { db } from "@/api/db";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useProducts } from "@/lib/useProducts";
import { isDistributorParty } from "@/lib/partyUtils";
import {
  buildDailyOrderDetail,
  buildDemandMap,
  buildGrid,
  buildOpeningStockGrid,
  buildProductionPlan,
  openingStockTotals,
  productionPlanTotals,
  sumQuantities,
  toOpeningStockMap,
  toQuantityMap,
} from "@/lib/productionUtils";
import { PAGE_MARGIN, SUMMARY_FONT_SIZES, renderGridTable } from "@/lib/summaryPdf";
import {
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Eraser,
  FileDown,
  History,
  Loader2,
  Package,
  PackageCheck,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
  TrendingDown,
  Wand2,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

const numberFmt = new Intl.NumberFormat("en-IN");

const localDateISO = (value = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDaysISO = (iso, offset) => {
  const [year, month, day] = String(iso).split("-").map(Number);
  const value = new Date(year, month - 1, day, 12, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return localDateISO(value);
};

const STATUS_STYLES = {
  short: "border-red-200 bg-red-50 text-red-700",
  tight: "border-amber-200 bg-amber-50 text-amber-700",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  idle: "border-border bg-muted/40 text-muted-foreground",
};

const STATUS_LABELS = {
  short: "Produce",
  tight: "Just covered",
  ok: "Covered",
  idle: "No order",
};

const TABS = [
  { id: "plan", label: "Morning Stock & Requirement", icon: Boxes },
  { id: "orders", label: "Today's Orders", icon: ClipboardList },
  { id: "production", label: "Production Entry", icon: PackageCheck },
  { id: "history", label: "History", icon: History },
];

function StatusPill({ status }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.idle}`}>
      {STATUS_LABELS[status] || "No order"}
    </span>
  );
}

const QtyInput = ({ value, onChange, label }) => (
  <Input
    type="number"
    min="0"
    step="1"
    inputMode="numeric"
    aria-label={label}
    value={value}
    onFocus={(event) => event.target.select()}
    onChange={(event) => onChange(event.target.value)}
    className="ml-auto w-20 text-right"
  />
);

export default function DailyProduction() {
  const { toast } = useToast();
  const { categories, productList } = useProducts();
  const loadSeq = useRef(0);

  const [date, setDate] = useState(() => localDateISO());
  const [tab, setTab] = useState("plan");
  const [records, setRecords] = useState([]);
  const [orders, setOrders] = useState([]);
  const [bills, setBills] = useState([]);
  const [openingStock, setOpeningStock] = useState([]);
  const [entries, setEntries] = useState([]);
  const [closingStock, setClosingStock] = useState([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");

  const loadAll = useCallback(async () => {
    const sequence = ++loadSeq.current;
    setLoading(true);
    setLoadError("");

    const results = await Promise.allSettled([
      db.entities.DailyProduction.list("-production_date", 500),
      db.entities.Order.filter({ order_date: date }, null, 1000),
      db.entities.Bill.filter({ invoice_date: date }, null, 1000),
    ]);

    if (sequence !== loadSeq.current) return;

    const messages = [];
    const [productionResult, ordersResult, billsResult] = results;

    if (productionResult.status === "fulfilled") setRecords(productionResult.value || []);
    else messages.push(`production: ${productionResult.reason?.message || productionResult.reason}`);

    if (ordersResult.status === "fulfilled") setOrders(ordersResult.value || []);
    else messages.push(`orders: ${ordersResult.reason?.message || ordersResult.reason}`);

    if (billsResult.status === "fulfilled") setBills(billsResult.value || []);
    else messages.push(`bills: ${billsResult.reason?.message || billsResult.reason}`);

    if (messages.length) setLoadError(messages.join(" · "));
    setLoading(false);
  }, [date]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Keep one authoritative record per date even if older saves created duplicates.
  const historyRows = useMemo(() => {
    const byDate = new Map();
    records.forEach((record) => {
      const stamp = String(record.updated_at || record.created_at || "");
      const current = byDate.get(record.production_date);
      const currentStamp = current ? String(current.updated_at || current.created_at || "") : "";
      if (!current || stamp > currentStamp) byDate.set(record.production_date, record);
    });
    return [...byDate.values()].sort((a, b) => b.production_date.localeCompare(a.production_date));
  }, [records]);

  const selected = useMemo(() => historyRows.find((record) => record.production_date === date), [historyRows, date]);
  const previousRecord = useMemo(() => historyRows.find((record) => record.production_date < date), [historyRows, date]);

  useEffect(() => {
    setOpeningStock(buildOpeningStockGrid(productList, selected?.opening_stock || []));
    setEntries(buildGrid(productList, selected?.entries || []));
    setClosingStock(buildGrid(productList, selected?.closing_stock || []));
    setNotes(selected?.notes || "");
    setDirty(false);
  }, [selected?.id, selected?.updated_at, productList]);

  // All orders for the selected day are demand. A dispatched order and its
  // invoice describe the same bottles, so buildDemandMap counts them once.
  const demandMap = useMemo(() => buildDemandMap({ orders, bills, date }), [orders, bills, date]);
  const openingMap = useMemo(() => toOpeningStockMap(openingStock), [openingStock]);

  const plan = useMemo(
    () => buildProductionPlan({ productList, opening: openingMap, demand: demandMap }),
    [productList, openingMap, demandMap]
  );
  const planTotals = useMemo(() => productionPlanTotals(plan), [plan]);
  const openingTotals = useMemo(() => openingStockTotals(openingStock), [openingStock]);
  const producedTotal = sumQuantities(entries);
  const closingTotal = sumQuantities(closingStock);

  const detailRows = useMemo(
    () =>
      buildDailyOrderDetail({
        orders,
        date,
        partyLabel: (order) => ({
          name: order.display_name || order.customer_name || "Unknown",
          type: isDistributorParty(order) ? "Distributor" : "Customer",
        }),
      }),
    [orders, date]
  );

  const detailTotals = useMemo(
    () =>
      detailRows.reduce(
        (total, row) => ({
          crates: total.crates + row.crates,
          loose: total.loose + row.loose,
          bottles: total.bottles + row.bottles,
        }),
        { crates: 0, loose: 0, bottles: 0 }
      ),
    [detailRows]
  );

  const needle = query.trim().toLowerCase();
  const visiblePlan = useMemo(
    () => plan.filter((row) => !needle || `${row.category} ${row.flavour}`.toLowerCase().includes(needle)),
    [plan, needle]
  );
  const visibleDetail = useMemo(
    () =>
      detailRows.filter(
        (row) =>
          !needle ||
          `${row.orderNo} ${row.partyName} ${row.partyType} ${row.category} ${row.flavour}`
            .toLowerCase()
            .includes(needle)
      ),
    [detailRows, needle]
  );

  const planGroups = useMemo(() => {
    const groups = new Map();
    visiblePlan.forEach((row) => {
      if (!groups.has(row.category)) groups.set(row.category, []);
      groups.get(row.category).push(row);
    });
    return [...groups.entries()];
  }, [visiblePlan]);

  const entryGroups = useMemo(() => {
    const produced = toQuantityMap(entries);
    return categories
      .map((category) => ({
        category,
        items: entries.filter(
          (item) =>
            item.category === category &&
            (!needle || `${item.category} ${item.flavour}`.toLowerCase().includes(needle))
        ),
        produced,
      }))
      .filter((group) => group.items.length > 0);
  }, [categories, entries, needle]);

  const chartData = useMemo(
    () =>
      historyRows
        .slice(0, 14)
        .reverse()
        .map((record) => ({
          date: record.production_date.slice(5),
          produced: Number(record.total_units) || 0,
          opening: openingStockTotals(record.opening_stock || []).bottles,
          closing: sumQuantities(record.closing_stock || []),
        })),
    [historyRows]
  );

  const setOpeningQuantity = (key, field, value) => {
    setOpeningStock((previous) =>
      previous.map((row) => (row.key === key ? { ...row, [field]: Number(value) || 0 } : row))
    );
    setDirty(true);
  };

  const setQuantity = (setter, key, value) => {
    setter((previous) =>
      previous.map((item) => (item.key === key ? { ...item, quantity: value } : item))
    );
    setDirty(true);
  };

  const changeDate = (next) => {
    if (!next || next === date) return;
    if (dirty && !window.confirm("Discard unsaved production changes for this date?")) return;
    setDate(next);
  };

  const copyPrevious = () => {
    if (!previousRecord) {
      toast({ title: "No earlier record", description: "There is no previous day to copy." });
      return;
    }
    if (dirty && !window.confirm("Replace the current morning stock with the previous day's values?")) return;
    setOpeningStock(buildOpeningStockGrid(productList, previousRecord.opening_stock || []));
    setDirty(true);
    toast({ title: `Copied morning stock from ${previousRecord.production_date}` });
  };

  const clearAll = () => {
    if (!window.confirm("Clear all morning stock, production and closing quantities for this date?")) return;
    setOpeningStock((previous) => previous.map((row) => ({ ...row, crates: 0, loose: 0 })));
    setEntries((previous) => previous.map((row) => ({ ...row, quantity: 0 })));
    setClosingStock((previous) => previous.map((row) => ({ ...row, quantity: 0 })));
    setDirty(true);
  };

  const fillPending = () => {
    if (planTotals.pending === 0) {
      toast({ title: "Nothing to produce", description: "Opening stock already covers this day's orders." });
      return;
    }
    if (dirty && !window.confirm("Replace the current production quantities with the calculated requirement?")) return;
    setEntries((previous) =>
      previous.map((row) => {
        const target = plan.find((item) => item.key === row.key);
        return target ? { ...row, quantity: target.pending } : row;
      })
    );
    setDirty(true);
    toast({ title: "Production filled", description: "Editable quantities now match the pending requirement." });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const clean = (rows) =>
        rows
          .filter((row) => Number(row.quantity) > 0)
          .map((row) => ({
            category: row.category,
            flavour: row.flavour,
            quantity: Number(row.quantity),
          }));
      const cleanOpening = (rows) =>
        rows
          .filter((row) => Number(row.crates) > 0 || Number(row.loose) > 0)
          .map((row) => ({
            category: row.category,
            flavour: row.flavour,
            crates: Number(row.crates) || 0,
            loose: Number(row.loose) || 0,
          }));

      const production = clean(entries);
      const closing = clean(closingStock);
      const opening = cleanOpening(openingStock);
      const payload = {
        production_date: date,
        opening_stock: opening,
        entries: production,
        closing_stock: closing,
        total_units: production.reduce((sum, entry) => sum + entry.quantity, 0),
        notes: notes.trim() || null,
      };

      if (selected) await db.entities.DailyProduction.update(selected.id, payload);
      else await db.entities.DailyProduction.create(payload);

      setDirty(false);
      await loadAll();
      toast({
        title: `Production saved for ${date}`,
        description: `${numberFmt.format(openingTotals.bottles)} opening · ${numberFmt.format(planTotals.pending)} to produce`,
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Could not save production", description: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record) => {
    if (!window.confirm(`Delete the production record for ${record.production_date}?`)) return;
    try {
      await db.entities.DailyProduction.delete(record.id);
      toast({ title: `Deleted production for ${record.production_date}` });
      await loadAll();
    } catch (error) {
      toast({ variant: "destructive", title: "Could not delete record", description: error.message });
    }
  };

  const openRecord = (record) => {
    if (dirty && !window.confirm("Discard unsaved production changes?")) return;
    setDate(record.production_date);
    setTab("plan");
  };

  const exportPdf = async () => {
    const rows = plan.filter((row) => row.ordered || row.openingBottles || row.pending);
    if (!rows.length) {
      toast({ title: "Nothing to export", description: "Enter morning stock or create orders for this date first." });
      return;
    }

    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF("l", "mm", "a4");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(SUMMARY_FONT_SIZES.title);
    pdf.setTextColor(0);
    pdf.text(`Production Plan — ${date}`, PAGE_MARGIN, 18);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(SUMMARY_FONT_SIZES.lead);
    pdf.text(
      `${detailRows.length} order line(s) · ${numberFmt.format(planTotals.ordered)} bottles demanded · ${numberFmt.format(planTotals.pending)} to produce · A4 landscape`,
      PAGE_MARGIN,
      26
    );

    const y = renderGridTable(
      pdf,
      {
        title: "Morning Stock vs Order Demand",
        lead: [{ header: "Product" }, { header: "Flavour" }],
        cols: [
          { header: "Open Cr" },
          { header: "Open Lo" },
          { header: "Open Btl" },
          { header: "Ordered" },
          { header: "Prod Cr" },
          { header: "Prod Lo" },
          { header: "Produce" },
        ],
        rows: rows.map((row) => ({
          lead: [row.category, row.flavour],
          cells: [
            [String(row.openingCrates)],
            [String(row.openingLoose)],
            [String(row.openingBottles)],
            [String(row.ordered)],
            [String(row.pendingCrates)],
            [String(row.pendingLoose)],
            [String(row.pending)],
          ],
        })),
        footer: {
          lead: ["TOTAL", ""],
          cells: [
            [String(openingTotals.crates)],
            [String(openingTotals.loose)],
            [String(planTotals.openingBottles)],
            [String(planTotals.ordered)],
            [""],
            [""],
            [String(planTotals.pending)],
          ],
        },
      },
      32
    );

    if (notes.trim()) {
      let cursor = y + 4;
      if (cursor + 58 > 200) {
        pdf.addPage();
        cursor = PAGE_MARGIN;
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(SUMMARY_FONT_SIZES.body);
      pdf.text("Notes", PAGE_MARGIN, cursor + 4);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(SUMMARY_FONT_SIZES.lead);
      const lines = pdf.splitTextToSize(notes.trim(), pdf.internal.pageSize.getWidth() - 2 * PAGE_MARGIN);
      lines.slice(0, 8).forEach((line, index) => {
        pdf.text(line, PAGE_MARGIN, cursor + 12 + index * 6);
      });
    }

    pdf.save(`production_plan_${date}.pdf`);
    toast({ title: "Production PDF saved", description: "A4 landscape" });
  };

  return (
    <PageShell
      title="Production"
      subtitle="Enter morning factory stock (crates + loose), then see exactly what must be produced for that day's orders"
      actions={
        <>
          <Button variant="outline" onClick={loadAll} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" onClick={exportPdf}>
            <FileDown className="h-4 w-4 mr-2" /> PDF
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => changeDate(addDaysISO(date, -1))} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(event) => changeDate(event.target.value)}
            className="w-44"
            aria-label="Production date"
          />
          <Button variant="outline" size="icon" onClick={() => changeDate(addDaysISO(date, 1))} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => changeDate(localDateISO())}>Today</Button>
          {selected ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              Saved {selected.updated_at ? new Date(selected.updated_at).toLocaleString() : ""}
            </span>
          ) : (
            <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Not saved</span>
          )}
          {dirty && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Unsaved changes</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={copyPrevious} disabled={!previousRecord || loading}>
            <Copy className="h-4 w-4 mr-2" /> Copy previous stock
          </Button>
          <Button variant="outline" size="sm" onClick={fillPending}>
            <Wand2 className="h-4 w-4 mr-2" /> Fill pending into production
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save production
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Some data could not be loaded: {loadError}</span>
        </div>
      )}

      {loading && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading production data…
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Opening stock" value={numberFmt.format(openingTotals.bottles)} hint={`${openingTotals.crates} crates + ${openingTotals.loose} loose`} icon={Boxes} tone="sky" />
        <StatCard label={`Demand · ${date}`} value={numberFmt.format(planTotals.ordered)} hint={`${detailRows.length} order line(s)`} icon={ClipboardList} tone="slate" />
        <StatCard label="To produce" value={numberFmt.format(planTotals.pending)} hint="bottles short after opening stock" icon={Package} tone={planTotals.pending ? "red" : "emerald"} />
        <StatCard label="Produced" value={numberFmt.format(producedTotal)} hint="bottles entered" icon={PackageCheck} tone="primary" />
        <StatCard label="Production lines" value={numberFmt.format(planTotals.shortLines)} hint={planTotals.shortLines ? "flavours need production" : "all flavours covered"} icon={TrendingDown} tone={planTotals.shortLines ? "amber" : "emerald"} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <Button key={item.id} variant={active ? "default" : "outline"} size="sm" onClick={() => setTab(item.id)}>
              <Icon className="h-4 w-4 mr-2" /> {item.label}
            </Button>
          );
        })}
      </div>

      {tab === "plan" && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <header className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">Morning stock &amp; requirement — {date}</h3>
              <p className="text-[11px] text-muted-foreground">
                Enter crates + loose counted at the factory in the morning. “To produce” = that day&apos;s ordered bottles − opening stock.
              </p>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product" className="w-52 pl-8" />
            </div>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Flavour</th>
                  <th className="px-3 py-2 text-right font-medium">Open Cr</th>
                  <th className="px-3 py-2 text-right font-medium">Open Lo</th>
                  <th className="px-3 py-2 text-right font-medium">Open Btl</th>
                  <th className="px-3 py-2 text-right font-medium">Ordered</th>
                  <th className="px-3 py-2 text-right font-medium">Prod Cr</th>
                  <th className="px-3 py-2 text-right font-medium">Prod Lo</th>
                  <th className="px-3 py-2 text-right font-medium">To produce</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {planGroups.map(([category, rows]) => {
                  const groupTotals = productionPlanTotals(rows);
                  return (
                    <Fragment key={category}>
                      <tr className="bg-primary/5">
                        <td colSpan={9} className="px-3 py-2">
                          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-primary">
                            <span>{category}</span>
                            <span>{numberFmt.format(groupTotals.ordered)} ordered · {numberFmt.format(groupTotals.pending)} to produce</span>
                          </div>
                        </td>
                      </tr>
                      {rows.map((row) => (
                        <tr key={row.key} className="border-t border-border/60">
                          <td className="px-3 py-1.5">{row.flavour}</td>
                          <td className="px-3 py-1.5 text-right">
                            <QtyInput
                              label={`${row.category} ${row.flavour} opening crates`}
                              value={openingStock.find((item) => item.key === row.key)?.crates ?? 0}
                              onChange={(value) => setOpeningQuantity(row.key, "crates", value)}
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <QtyInput
                              label={`${row.category} ${row.flavour} opening loose`}
                              value={openingStock.find((item) => item.key === row.key)?.loose ?? 0}
                              onChange={(value) => setOpeningQuantity(row.key, "loose", value)}
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{numberFmt.format(row.openingBottles)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold">{numberFmt.format(row.ordered)}</td>
                          <td className={`px-3 py-1.5 text-right font-semibold ${row.pendingCrates ? "text-red-600" : "text-muted-foreground"}`}>{row.pendingCrates}</td>
                          <td className={`px-3 py-1.5 text-right font-semibold ${row.pendingLoose ? "text-red-600" : "text-muted-foreground"}`}>{row.pendingLoose}</td>
                          <td className={`px-3 py-1.5 text-right font-bold ${row.pending ? "text-red-600" : "text-emerald-700"}`}>{numberFmt.format(row.pending)}</td>
                          <td className="px-3 py-1.5 text-center"><StatusPill status={row.status} /></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                {planGroups.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-sm text-muted-foreground">
                      {query ? "No products match this search." : "No products configured in Settings."}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/40 font-semibold">
                <tr>
                  <td className="px-3 py-2">TOTAL</td>
                  <td className="px-3 py-2 text-right">{openingTotals.crates}</td>
                  <td className="px-3 py-2 text-right">{openingTotals.loose}</td>
                  <td className="px-3 py-2 text-right">{numberFmt.format(planTotals.openingBottles)}</td>
                  <td className="px-3 py-2 text-right">{numberFmt.format(planTotals.ordered)}</td>
                  <td className="px-3 py-2 text-right">—</td>
                  <td className="px-3 py-2 text-right">—</td>
                  <td className="px-3 py-2 text-right text-red-600">{numberFmt.format(planTotals.pending)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {tab === "orders" && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <header className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">Orders for {date}</h3>
              <p className="text-[11px] text-muted-foreground">
                Every customer and distributor/hotel order line for this day. Dispatched lines are counted once.
              </p>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, party or product" className="w-64 pl-8" />
            </div>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Internal #</th>
                  <th className="px-3 py-2 font-medium">Party</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 text-right font-medium">Crates</th>
                  <th className="px-3 py-2 text-right font-medium">Loose</th>
                  <th className="px-3 py-2 text-right font-medium">Bottles</th>
                </tr>
              </thead>
              <tbody>
                {visibleDetail.map((row) => (
                  <tr key={row.key} className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium text-primary">{row.orderNo}</td>
                    <td className="px-3 py-2">{row.partyName}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${row.partyType === "Distributor" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                        {row.partyType}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{row.category} · {row.flavour}</td>
                    <td className="px-3 py-2 text-right">{row.crates}</td>
                    <td className="px-3 py-2 text-right">{row.loose}</td>
                    <td className="px-3 py-2 text-right font-semibold">{numberFmt.format(row.bottles)}</td>
                  </tr>
                ))}
                {visibleDetail.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                      No orders on this date{query ? " match this search" : ""}.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/40 font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={4}>TOTAL</td>
                  <td className="px-3 py-2 text-right">{detailTotals.crates}</td>
                  <td className="px-3 py-2 text-right">{detailTotals.loose}</td>
                  <td className="px-3 py-2 text-right text-primary">{numberFmt.format(detailTotals.bottles)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {tab === "production" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">Production entry — {date}</h3>
              <p className="text-[11px] text-muted-foreground">Record what was actually produced; closing stock is optional.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product" className="w-52 pl-8" />
              </div>
              <Button variant="outline" size="sm" onClick={clearAll}><Eraser className="h-4 w-4 mr-2" /> Clear</Button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <header className="flex items-center justify-between border-b border-border bg-primary/5 px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-primary">Produced today</h3>
                  <p className="text-[11px] text-muted-foreground">Bottles produced for this day</p>
                </div>
                <span className="text-lg font-bold text-primary">{numberFmt.format(producedTotal)}</span>
              </header>
              <div className="max-h-[30rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Flavour</th>
                      <th className="px-3 py-2 text-right font-medium">Bottles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entryGroups.map((group) => (
                      <Fragment key={group.category}>
                        <tr className="bg-primary/5">
                          <td colSpan={2} className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-primary">{group.category}</td>
                        </tr>
                        {group.items.map((item) => (
                          <tr key={item.key} className="border-t border-border/50">
                            <td className="px-3 py-1.5">{item.flavour}</td>
                            <td className="px-3 py-1.5 text-right">
                              <Input type="number" min="0" step="1" inputMode="numeric" value={item.quantity}
                                onFocus={(event) => event.target.select()}
                                onChange={(event) => setQuantity(setEntries, item.key, event.target.value)}
                                className="ml-auto w-28 text-right" />
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <header className="flex items-center justify-between border-b border-border bg-sky-50 px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-sky-800">Closing stock at factory</h3>
                  <p className="text-[11px] text-sky-700/80">Bottles left after the day&apos;s dispatch</p>
                </div>
                <span className="text-lg font-bold text-sky-800">{numberFmt.format(closingTotal)}</span>
              </header>
              <div className="max-h-[30rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Flavour</th>
                      <th className="px-3 py-2 text-right font-medium">Bottles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entryGroups.map((group) => (
                      <Fragment key={group.category}>
                        <tr className="bg-sky-50">
                          <td colSpan={2} className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-sky-800">{group.category}</td>
                        </tr>
                        {group.items.map((item) => (
                          <tr key={item.key} className="border-t border-border/50">
                            <td className="px-3 py-1.5">{item.flavour}</td>
                            <td className="px-3 py-1.5 text-right">
                              <Input type="number" min="0" step="1" inputMode="numeric" value={closingStock.find((c) => c.key === item.key)?.quantity ?? 0}
                                onFocus={(event) => event.target.select()}
                                onChange={(event) => setQuantity(setClosingStock, item.key, event.target.value)}
                                className="ml-auto w-28 text-right" />
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Shift notes</h3>
              <span className="text-[11px] text-muted-foreground">Optional</span>
            </div>
            <Textarea rows={3} value={notes} onChange={(event) => { setNotes(event.target.value); setDirty(true); }}
              placeholder="Machine issues, extra batches, dispatch notes…" />
          </section>
        </div>
      )}

      {tab === "history" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <section className="overflow-hidden rounded-xl border border-border bg-card xl:col-span-2">
            <header className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Saved production days</h3>
              <p className="text-[11px] text-muted-foreground">Open a day to edit it, or delete old entries.</p>
            </header>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card/95 text-left text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Opening</th>
                    <th className="px-3 py-2 text-right font-medium">Produced</th>
                    <th className="px-3 py-2 text-right font-medium">Closing</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((record) => (
                    <tr key={record.id} className="cursor-pointer border-t border-border/60 hover:bg-accent/40" onClick={() => openRecord(record)}>
                      <td className="px-3 py-2 font-medium">{record.production_date}</td>
                      <td className="px-3 py-2 text-right">{numberFmt.format(openingStockTotals(record.opening_stock || []).bottles)}</td>
                      <td className="px-3 py-2 text-right">{numberFmt.format(Number(record.total_units) || 0)}</td>
                      <td className="px-3 py-2 text-right">{numberFmt.format(sumQuantities(record.closing_stock || []))}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); openRecord(record); }}>
                            <Pencil className="h-3.5 w-3.5 mr-1" /> Open
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={(event) => { event.stopPropagation(); handleDelete(record); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {historyRows.length === 0 && (
                    <tr><td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">No production records saved yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Last 14 production days</h3>
            <p className="mb-4 text-[11px] text-muted-foreground">Opening, produced and closing bottles</p>
            {chartData.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="opening" name="Opening" fill="#7dd3fc" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="produced" name="Produced" fill="#0f766e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="closing" name="Closing" fill="#a7f3d0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-[280px] place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                Save a production day to see the chart.
              </div>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
