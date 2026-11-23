import { useCallback, useEffect, useMemo, useState } from "react";

import PageShell from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import supabase from "@/lib/supabaseClient";
import { buildDemandForecast } from "@/lib/demandForecast";
import { itemBottles } from "@/lib/billUtils";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  BrainCircuit,
  RefreshCw,
  Loader2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  CalendarDays,
  Package,
  Hotel,
  ShoppingCart,
  IndianRupee,
  RotateCcw,
} from "lucide-react";

const GREENS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#3b82f6", "#a855f7", "#84cc16"];
const PAGE_SIZE = 1000;
const localDateISO = (value = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDaysISO = (iso, days) => {
  const [year, month, day] = String(iso).split("-").map(Number);
  const value = new Date(year, month - 1, day, 12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return localDateISO(value);
};

// Supabase/PostgREST caps a single response (usually at 1000 rows), so page
// through the whole table. This is what makes the forecast learn from ALL
// previous orders rather than only the newest 500.
async function fetchAllRows(table, orderColumn) {
  const rows = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderColumn, { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;

    from += PAGE_SIZE;
    if (from > 100000) break; // safety valve
  }

  return rows;
}

export default function DataAnalytics() {
  const [orders, setOrders] = useState([]);
  const [bills, setBills] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [production, setProduction] = useState([]);
  const [crates, setCrates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => addDaysISO(localDateISO(), 1));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    const results = await Promise.allSettled([
      fetchAllRows("orders", "order_date"),
      fetchAllRows("bills", "invoice_date"),
      fetchAllRows("deliveries", "delivery_date"),
      fetchAllRows("daily_productions", "production_date"),
      fetchAllRows("crate_entries", "entry_date"),
    ]);

    const messages = [];
    const [ordersResult, billsResult, deliveriesResult, productionResult, cratesResult] = results;

    if (ordersResult.status === "fulfilled") setOrders(ordersResult.value);
    else messages.push(`orders: ${ordersResult.reason?.message || ordersResult.reason}`);

    if (billsResult.status === "fulfilled") setBills(billsResult.value);
    else messages.push(`bills: ${billsResult.reason?.message || billsResult.reason}`);

    if (deliveriesResult.status === "fulfilled") setDeliveries(deliveriesResult.value);
    else messages.push(`deliveries: ${deliveriesResult.reason?.message || deliveriesResult.reason}`);

    if (productionResult.status === "fulfilled") setProduction(productionResult.value);
    else messages.push(`production: ${productionResult.reason?.message || productionResult.reason}`);

    if (cratesResult.status === "fulfilled") setCrates(cratesResult.value);
    else messages.push(`crate entries: ${cratesResult.reason?.message || cratesResult.reason}`);

    if (messages.length) setError(messages.join(" · "));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  // Orders are the primary training history. If the orders table is empty or
  // unreadable for this user, fall back to bills and then deliveries so the
  // page still produces a useful forecast from the history that is available.
  const demandRows = useMemo(() => {
    if (orders.length > 0) return orders;

    if (bills.length > 0) {
      return bills.map((bill) => ({
        ...bill,
        order_date: bill.invoice_date,
        display_name: bill.customer_name,
        total_bottles: (bill.items || []).reduce((total, item) => total + itemBottles(item), 0),
        total_amount: Number(bill.total) || 0,
      }));
    }

    return deliveries.map((delivery) => ({
      ...delivery,
      order_date: delivery.delivery_date,
      display_name: delivery.customer_name,
      total_bottles: delivery.total_bottles,
      total_amount: delivery.total_amount,
    }));
  }, [orders, bills, deliveries]);

  const fallbackSource =
    orders.length > 0 ? "" : bills.length > 0 ? "bills" : deliveries.length > 0 ? "deliveries" : "";

  // Bills carry the same item lines as deliveries, so use them as a delivery
  // ledger when there are no delivery rows yet.
  const deliveryRows = useMemo(() => {
    if (deliveries.length > 0) return deliveries;
    return bills.map((bill) => ({
      ...bill,
      delivery_date: bill.invoice_date,
      total_bottles: (bill.items || []).reduce((total, item) => total + itemBottles(item), 0),
    }));
  }, [bills, deliveries]);

  const model = useMemo(
    () => buildDemandForecast(demandRows, { targetDate: selectedDate }),
    [demandRows, selectedDate]
  );

  const numberFmt = useMemo(() => new Intl.NumberFormat("en-IN"), []);
  const inrFmt = useMemo(
    () => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }),
    []
  );

  const productionVsOrders = useMemo(() => {
    const byDate = new Map();

    const ensure = (date) => {
      if (!date) return null;
      let row = byDate.get(date);
      if (!row) {
        row = { date, produced: 0, delivered: 0, ordered: 0, orderCount: 0 };
        byDate.set(date, row);
      }
      return row;
    };

    production.forEach((entry) => {
      const row = ensure(entry.production_date);
      if (row) row.produced += Number(entry.total_units) || 0;
    });

    deliveryRows.forEach((entry) => {
      const row = ensure(entry.delivery_date);
      if (row) row.delivered += Number(entry.total_bottles) || 0;
    });

    model.daily.forEach((entry) => {
      const row = ensure(entry.date);
      if (!row) return;
      row.ordered += Number(entry.bottles) || 0;
      row.orderCount += Number(entry.orders) || 0;
    });

    return [...byDate.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);
  }, [production, deliveryRows, model.daily]);

  const paymentStatus = useMemo(() => {
    const completed = deliveryRows.filter((delivery) => delivery.payment_status === "completed").length;
    return [
      { name: "Completed", value: completed },
      { name: "Pending", value: Math.max(0, deliveryRows.length - completed) },
    ];
  }, [deliveryRows]);

  const crateStats = useMemo(
    () => ({
      returned: crates.reduce((total, entry) => total + (Number(entry.crates_returned) || 0), 0),
      damaged: crates.reduce((total, entry) => total + (Number(entry.damaged_bottles) || 0), 0),
    }),
    [crates]
  );

  const predictedFlavours = model.flavourForecast.slice(0, 10);
  const flavourHistory = model.flavourHistory.slice(0, 10);
  const topHotels = model.topHotelsHistory.slice(0, 6);
  const TrendIcon = model.trend.direction === "rising" ? TrendingUp : model.trend.direction === "falling" ? TrendingDown : Minus;
  const trendText =
    model.trend.changePct == null
      ? "Not enough history"
      : `${model.trend.changePct >= 0 ? "+" : ""}${model.trend.changePct.toFixed(1)}% vs previous 30d`;

  const kpis = [
    { label: "Total Orders", value: numberFmt.format(model.history.orders), icon: ShoppingCart },
    { label: "Bottles Ordered", value: numberFmt.format(model.history.bottles), icon: Package },
    { label: "Order Value", value: inrFmt.format(model.history.revenue), icon: IndianRupee },
    { label: "Hotels Served", value: numberFmt.format(model.history.hotels), icon: Hotel },
    { label: "Crates Returned", value: numberFmt.format(crateStats.returned), icon: RotateCcw },
    { label: "Damaged Bottles", value: numberFmt.format(crateStats.damaged), icon: AlertTriangle },
  ];

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Forecast date</span>
      <Input type="date" value={selectedDate} min={localDateISO()} onChange={(event) => setSelectedDate(event.target.value)} className="w-44" aria-label="Forecast date" />
      <Button variant="outline" size="sm" onClick={() => setSelectedDate(localDateISO())}>Today</Button>
      <Button variant="outline" size="sm" onClick={() => setSelectedDate(addDaysISO(localDateISO(), 1))}>Tomorrow</Button>
      <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading || refreshing}>
        {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
        Refresh
      </Button>
    </div>
  );

  if (loading) {
    return (
      <PageShell title="Data Analytics" subtitle="Loading every order and training the forecast">
        <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-white p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading all orders and building the prediction model…
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Data Analytics"
      subtitle="Order-demand forecasting trained on every previous order"
      actions={actions}
    >
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Some history could not be loaded ({error}). The forecast uses whatever was readable.</span>
        </div>
      )}

      {fallbackSource && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-sky-300 bg-sky-50 p-3 text-xs text-sky-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No order rows were readable, so the model is learning from the {fallbackSource} history instead.
          </span>
        </div>
      )}

      {!model.ok ? (
        <div className="rounded-xl border border-primary/20 bg-white p-8 text-center">
          <BrainCircuit className="mx-auto h-10 w-10 text-primary/50" />
          <h3 className="mt-3 text-base font-semibold text-primary">No order history yet</h3>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            Create orders in Incoming Orders or Orders. This page reads every order row and trains the forecast automatically — no external AI service is required.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {kpis.map(({ label, value, icon: Icon }) => (
              <Card key={label} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <Icon className="h-4 w-4 text-primary/60" />
                </div>
                <div className="mt-1 text-lg font-bold text-primary">{value}</div>
              </Card>
            ))}
          </div>

          <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <BrainCircuit className="h-4 w-4" /> Order Forecast — {selectedDate}
                </h3>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  Trained on every {fallbackSource || "order"} row in history ({numberFmt.format(model.history.orders)}) using {model.modelLabel}.
                </p>
              </div>
              <div className="text-right text-[11px] text-muted-foreground">
                <div>History: {model.history.firstDate} → {model.history.lastDate}</div>
                <div>{model.history.activeDays} active days · {model.history.hotels} hotels · {model.history.flavours} flavours</div>
                {model.backtest ? (
                  <div>Backtest (last {model.backtest.days}d): {model.backtest.orderAccuracy.toFixed(0)}% orders / {model.backtest.bottleAccuracy.toFixed(0)}% bottles</div>
                ) : (
                  <div>Backtest needs at least 21 days of history</div>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-primary/15 bg-white p-3">
                <div className="text-[11px] text-muted-foreground">Expected Orders</div>
                <div className="text-xl font-bold text-primary">{numberFmt.format(model.totals.orders)}</div>
                <div className="text-[10px] text-muted-foreground">on {selectedDate}</div>
              </div>
              <div className="rounded-lg border border-primary/15 bg-white p-3">
                <div className="text-[11px] text-muted-foreground">Expected Bottles</div>
                <div className="text-xl font-bold text-primary">{numberFmt.format(model.totals.bottles)}</div>
                <div className="text-[10px] text-muted-foreground">on {selectedDate}</div>
              </div>
              <div className="rounded-lg border border-primary/15 bg-white p-3">
                <div className="text-[11px] text-muted-foreground">Busiest Day</div>
                <div className="text-xl font-bold text-primary">{model.busiestDay?.weekday || "—"}</div>
                <div className="text-[10px] text-muted-foreground">{model.busiestDay ? `${model.busiestDay.date} · ~${model.busiestDay.bottles} bottles` : "—"}</div>
              </div>
              <div className="rounded-lg border border-primary/15 bg-white p-3">
                <div className="text-[11px] text-muted-foreground">Demand Trend</div>
                <div className="flex items-center gap-1 text-xl font-bold text-primary">
                  <TrendIcon className="h-4 w-4" /> {model.trend.changePct == null ? "—" : `${model.trend.changePct >= 0 ? "+" : ""}${model.trend.changePct.toFixed(1)}%`}
                </div>
                <div className="text-[10px] text-muted-foreground">{trendText}</div>
              </div>
            </div>

            <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-primary/10 bg-white/70 p-3 text-xs leading-relaxed text-foreground">
              {model.summaryLines.join("\n")}
            </pre>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-primary/20 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary">Predicted Orders &amp; Bottles — {selectedDate}</h3>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={model.forecastDays}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="weekday" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="bottles" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="bottles" dataKey="bottles" name="Bottles" fill={GREENS[3]} radius={[4, 4, 0, 0]} />
                  <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke={GREENS[0]} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-primary/20 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary">Forecast by Day</h3>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Day</th>
                    <th className="p-2 text-right">Orders</th>
                    <th className="p-2 text-right">Bottles</th>
                  </tr>
                </thead>
                <tbody>
                  {model.forecastDays.map((day) => (
                    <tr key={day.date} className="border-t border-primary/10">
                      <td className="p-2">{day.date}</td>
                      <td className="p-2">{day.weekday}</td>
                      <td className="p-2 text-right font-semibold text-primary">{day.orders}</td>
                      <td className="p-2 text-right font-semibold text-primary">{day.bottles}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-primary/30 bg-primary/5 font-bold">
                    <td className="p-2" colSpan={2}>Total</td>
                    <td className="p-2 text-right text-primary">{model.totals.orders}</td>
                    <td className="p-2 text-right text-primary">{model.totals.bottles}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-primary/20 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary">Predicted Flavour Demand — {selectedDate}</h3>
              {predictedFlavours.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={predictedFlavours} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="flavour" tick={{ fontSize: 10 }} width={90} />
                    <Tooltip />
                    <Bar dataKey="bottles" name="Bottles" radius={[0, 4, 4, 0]}>
                      {predictedFlavours.map((_, i) => <Cell key={i} fill={GREENS[i % GREENS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No flavour-level history yet.</p>
              )}
            </div>

            <div className="rounded-xl border border-primary/20 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary">Flavour &amp; Category Forecast — {selectedDate}</h3>
              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white text-xs text-muted-foreground">
                    <tr>
                      <th className="p-2 text-left">Category</th>
                      <th className="p-2 text-left">Flavour</th>
                      <th className="p-2 text-right">Orders</th>
                      <th className="p-2 text-right">Bottles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.flavourForecast.map((item) => (
                      <tr key={item.key} className="border-t border-primary/10">
                        <td className="p-2 text-xs text-muted-foreground">{item.category}</td>
                        <td className="p-2">{item.flavour}</td>
                        <td className="p-2 text-right">{item.orders}</td>
                        <td className="p-2 text-right font-semibold text-primary">{item.bottles}</td>
                      </tr>
                    ))}
                    {model.flavourForecast.length === 0 && (
                      <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No flavour forecast available.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-primary/20 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-primary">Predicted Orders by Hotel — {selectedDate}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Hotel</th>
                    <th className="p-2 text-right">Expected Orders</th>
                    <th className="p-2 text-right">Expected Bottles</th>
                    <th className="p-2 text-right">History Orders</th>
                    <th className="p-2 text-right">History Bottles</th>
                    <th className="p-2 text-right">Last Order</th>
                  </tr>
                </thead>
                <tbody>
                  {model.hotelForecast.slice(0, 12).map((hotel) => (
                    <tr key={hotel.name} className="border-t border-primary/10">
                      <td className="p-2 font-medium">{hotel.name}</td>
                      <td className="p-2 text-right font-semibold text-primary">{hotel.orders}</td>
                      <td className="p-2 text-right font-semibold text-primary">{hotel.bottles}</td>
                      <td className="p-2 text-right text-muted-foreground">{hotel.historyOrders}</td>
                      <td className="p-2 text-right text-muted-foreground">{hotel.historyBottles}</td>
                      <td className="p-2 text-right text-xs text-muted-foreground">{hotel.lastOrder}</td>
                    </tr>
                  ))}
                  {model.hotelForecast.length === 0 && (
                    <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No hotel history yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-primary/20 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary">Daily Orders &amp; Bottles — Last 30 Days</h3>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={model.historyChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="bottles" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="bottles" dataKey="bottles" name="Bottles" fill={GREENS[4]} radius={[4, 4, 0, 0]} />
                  <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke={GREENS[2]} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-primary/20 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary">Bottles Ordered by Flavour — All History</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={flavourHistory}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="flavour" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="bottles" name="Bottles" radius={[4, 4, 0, 0]}>
                    {flavourHistory.map((_, i) => <Cell key={i} fill={GREENS[i % GREENS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-primary/20 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary">Category Distribution — All History</h3>
              {model.categoryHistory.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={model.categoryHistory} dataKey="bottles" nameKey="category" cx="50%" cy="50%" outerRadius={90} label>
                      {model.categoryHistory.map((_, i) => <Cell key={i} fill={GREENS[i % GREENS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No category history yet.</p>
              )}
            </div>

            <div className="rounded-xl border border-primary/20 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary">Production vs Orders &amp; Deliveries — Last 14 Days</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={productionVsOrders}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="produced" name="Produced" fill={GREENS[0]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="ordered" name="Ordered" fill={GREENS[3]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="delivered" name="Delivered" fill={GREENS[2]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-primary/20 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary">Top Hotels by Bottles — All History</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topHotels} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="bottles" name="Bottles" radius={[0, 4, 4, 0]}>
                    {topHotels.map((_, i) => <Cell key={i} fill={GREENS[i % GREENS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-primary/20 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-primary">Payment Status</h3>
              {deliveryRows.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={paymentStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      <Cell fill={GREENS[0]} />
                      <Cell fill="#cbd5d1" />
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No delivery history yet.</p>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-primary/20 bg-white p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
              <CalendarDays className="h-4 w-4" /> How this forecast is produced
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Every order row is read (not just the latest page) and expanded into a daily history. For each day the model learns the day-of-week pattern, the recent level, and the recent trend. The selected date is forecast by blending that date&apos;s weekday pattern with the recent level, then applying the trend. Per-category, per-flavour and per-hotel predictions for {selectedDate} use the same history, with recent orders weighted more heavily. The backtest above re-runs the model one day at a time over the last 14 days and compares its prediction with what actually happened.
            </p>
          </div>
        </>
      )}
    </PageShell>
  );
}
