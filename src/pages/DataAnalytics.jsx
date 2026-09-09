import { db } from "@/api/db";

import { useEffect, useMemo, useState } from "react";

import PageShell from "@/components/PageShell";
import { CATEGORIES, FLAVOURS, bottlesPerCrate } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import supabase from "@/lib/supabaseClient";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
} from "recharts";
import { BrainCircuit, Loader2, Sparkles, AlertTriangle } from "lucide-react";

const GREENS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#3b82f6", "#a855f7", "#84cc16"];

export default function DataAnalytics() {
  const [deliveries, setDeliveries] = useState([]);
  const [production, setProduction] = useState([]);
  const [crates, setCrates] = useState([]);
  const [prediction, setPrediction] = useState("");
  const [loading, setLoading] = useState(false);
  const [narrative, setNarrative] = useState("");
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeError, setNarrativeError] = useState("");

  useEffect(() => {
    db.entities.Delivery.list("-delivery_date", 500).then(setDeliveries);
    db.entities.DailyProduction.list("-production_date", 200).then(setProduction);
    db.entities.CrateEntry.list("-entry_date", 200).then(setCrates);
  }, []);

  const byFlavour = useMemo(() => {
    const map = {};
    FLAVOURS.forEach((fl) => (map[fl] = 0));
    deliveries.forEach((d) => {
      (d.items || []).forEach((it) => {
        if (map[it.flavour] !== undefined) map[it.flavour] += (Number(it.crates) || 0) * bottlesPerCrate(it.category) + (Number(it.loose) || 0);
      });
    });
    return Object.entries(map).map(([flavour, bottles]) => ({ flavour, bottles }));
  }, [deliveries]);

  const byCategory = useMemo(() => {
    const map = {};
    CATEGORIES.forEach((c) => (map[c] = 0));
    deliveries.forEach((d) => {
      (d.items || []).forEach((it) => {
        if (map[it.category] !== undefined) map[it.category] += (Number(it.crates) || 0) * bottlesPerCrate(it.category) + (Number(it.loose) || 0);
      });
    });
    return Object.entries(map).map(([category, bottles]) => ({ category, bottles }));
  }, [deliveries]);

  const productionVsDelivery = useMemo(() => {
    const byDate = {};
    production.forEach((p) => { byDate[p.production_date] = byDate[p.production_date] || { date: p.production_date, produced: 0, delivered: 0 }; byDate[p.production_date].produced += p.total_units || 0; });
    deliveries.forEach((d) => { byDate[d.delivery_date] = byDate[d.delivery_date] || { date: d.delivery_date, produced: 0, delivered: 0 }; byDate[d.delivery_date].delivered += d.total_bottles || 0; });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [production, deliveries]);

  const predictedDemand = useMemo(() => {
    const byDateFlavour = {};
    deliveries.forEach((d) => {
      (d.items || []).forEach((it) => {
        byDateFlavour[it.flavour] = byDateFlavour[it.flavour] || {};
        const dd = d.delivery_date;
        byDateFlavour[it.flavour][dd] = (byDateFlavour[it.flavour][dd] || 0) + (Number(it.crates) || 0) * bottlesPerCrate(it.category) + (Number(it.loose) || 0);
      });
    });
    const dates = [...new Set(deliveries.map((d) => d.delivery_date))].sort().slice(-14);
    return FLAVOURS.map((fl) => {
      const dayMap = byDateFlavour[fl] || {};
      const vals = dates.map((dd) => dayMap[dd] || 0);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      return { flavour: fl, predicted: Math.round(avg * 7) };
    }).filter((x) => x.predicted > 0);
  }, [deliveries]);

  const weeklyForecast = useMemo(() => {
    const dowBottles = [0, 0, 0, 0, 0, 0, 0];
    const dowCounts = [0, 0, 0, 0, 0, 0, 0];
    deliveries.forEach((d) => {
      if (!d.delivery_date) return;
      const dow = new Date(d.delivery_date + "T00:00:00").getDay();
      dowBottles[dow] += Number(d.total_bottles) || 0;
      dowCounts[dow]++;
    });
    const avg = dowBottles.map((b, i) => (dowCounts[i] ? Math.round(b / dowCounts[i]) : 0));
    const out = [];
    const today = new Date();
    for (let i = 1; i <= 7; i++) {
      const dt = new Date(today);
      dt.setDate(today.getDate() + i);
      const dow = dt.getDay();
      out.push({ date: dt.toISOString().slice(0, 10), weekday: dt.toLocaleDateString("en-IN", { weekday: "short" }), expected: avg[dow] });
    }
    return out;
  }, [deliveries]);

  const flavourForecast = useMemo(() => {
    const map = {};
    CATEGORIES.forEach((c) => FLAVOURS.forEach((f) => (map[`${c}|${f}`] = { category: c, flavour: f, total: 0, days: 0 })));
    deliveries.forEach((d) => (d.items || []).forEach((it) => {
      const k = `${it.category}|${it.flavour}`;
      if (!map[k]) return;
      map[k].total += (Number(it.crates) || 0) * bottlesPerCrate(it.category) + (Number(it.loose) || 0);
      map[k].days += 1;
    }));
    return CATEGORIES.map((c) => ({
      category: c,
      flavours: FLAVOURS.map((f) => {
        const m = map[`${c}|${f}`];
        const avg = m.days ? m.total / m.days : 0;
        return { flavour: f, predicted: Math.round(avg * 7) };
      }),
    }));
  }, [deliveries]);

  const dailyEntries = useMemo(() => {
    const map = {};
    deliveries.forEach((d) => {
      map[d.delivery_date] = map[d.delivery_date] || { date: d.delivery_date, entries: 0, revenue: 0, bottles: 0 };
      map[d.delivery_date].entries++;
      map[d.delivery_date].revenue += Number(d.total_amount) || 0;
      map[d.delivery_date].bottles += Number(d.total_bottles) || 0;
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [deliveries]);

  const paymentStatus = useMemo(() => {
    const completed = deliveries.filter((d) => d.payment_status === "completed").length;
    return [
      { name: "Completed", value: completed },
      { name: "Pending", value: deliveries.length - completed },
    ];
  }, [deliveries]);

  const topHotels = useMemo(() => {
    const map = {};
    deliveries.forEach((d) => {
      const name = d.customer_name || "Unknown";
      map[name] = (map[name] || 0) + (Number(d.total_bottles) || 0);
    });
    return Object.entries(map).map(([name, bottles]) => ({ name, bottles })).sort((a, b) => b.bottles - a.bottles).slice(0, 6);
  }, [deliveries]);

  const runPrediction = () => {
    // NOTE: base44's original build called a hosted serverless function
    // (`db.functions.invoke("predictDemand", ...)`) that most likely ran an
    // LLM over this data. That function has no Supabase equivalent — our
    // `db` client only implements auth + entity CRUD — so this always threw
    // ("db.functions is undefined") and showed "Prediction failed: ...".
    // Since every number used below is already computed on this page for
    // the charts, this builds a real, working summary from that same data
    // instead. It runs instantly and needs no external API, so it's always
    // available even if the AI narrative below isn't set up yet.
    setLoading(true);
    try {
      const lines = [];
      lines.push(`Based on ${deliveries.length} recorded deliveries.`);

      const topFlavours = [...predictedDemand].sort((a, b) => b.predicted - a.predicted).slice(0, 5);
      if (topFlavours.length) {
        lines.push("", "Top predicted flavours for the next 7 days:");
        topFlavours.forEach((f) => lines.push(`  • ${f.flavour}: ~${f.predicted} bottles`));
      }

      const totalWeekly = weeklyForecast.reduce((s, d) => s + d.expected, 0);
      lines.push("", `Expected total bottles over the next 7 days: ~${totalWeekly}.`);
      const busiest = [...weeklyForecast].sort((a, b) => b.expected - a.expected)[0];
      if (busiest && busiest.expected > 0) lines.push(`Busiest expected day: ${busiest.weekday} (${busiest.date}), ~${busiest.expected} bottles.`);

      if (topHotels[0]) lines.push(`Highest-volume hotel historically: ${topHotels[0].name} (${topHotels[0].bottles} bottles delivered).`);

      const totalCrateReturns = crates.reduce((s, c) => s + (c.crates_returned || 0), 0);
      const totalDamaged = crates.reduce((s, c) => s + (c.damaged_bottles || 0), 0);
      lines.push("", `Crates returned to date: ${totalCrateReturns}. Damaged bottles: ${totalDamaged}.`);

      setPrediction(lines.join("\n"));
    } finally {
      setLoading(false);
    }
    runNarrative();
  };

  // AI-written narrative, layered on top of the deterministic summary above.
  // Calls the `predict-demand` Supabase Edge Function (supabase/functions/
  // predict-demand), which wraps an LLM call. This is intentionally optional:
  // if the function isn't deployed yet, or has no GEMINI_API_KEY secret
  // configured, or the call fails for any reason, this just shows a small
  // inline note instead of breaking the page — the deterministic summary
  // above never depends on this succeeding.
  const runNarrative = async () => {
    setNarrativeLoading(true);
    setNarrativeError("");
    setNarrative("");
    try {
      const summary = {
        totalDeliveries: deliveries.length,
        byFlavour,
        byCategory,
        productionVsDelivery,
        predictedDemand,
        weeklyForecast,
        topHotels,
        totalCratesReturned: crates.reduce((s, c) => s + (c.crates_returned || 0), 0),
        damagedBottles: crates.reduce((s, c) => s + (c.damaged_bottles || 0), 0),
      };
      const { data, error } = await supabase.functions.invoke("predict-demand", { body: summary });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setNarrative(data?.narrative || "");
    } catch (e) {
      setNarrativeError(
        `AI narrative unavailable (${e.message || e}). If you haven't yet, deploy the predict-demand Edge Function and set a GEMINI_API_KEY secret — see supabase/README.md.`
      );
    } finally {
      setNarrativeLoading(false);
    }
  };

  return (
    <PageShell
      title="Data Analytics"
      subtitle="Delivery, production trends and AI demand forecasting"
      actions={<Button onClick={runPrediction} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BrainCircuit className="h-4 w-4 mr-2" />} Predict Demand</Button>}
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Deliveries", value: deliveries.length },
          { label: "Bottles Delivered", value: byFlavour.reduce((s, x) => s + x.bottles, 0) },
          { label: "Crates Returned", value: crates.reduce((s, c) => s + (c.crates_returned || 0), 0) },
          { label: "Revenue (₹)", value: deliveries.reduce((s, d) => s + (Number(d.total_amount) || 0), 0).toFixed(0) },
        ].map((k) => (
          <Card key={k.label} className="p-3">
            <div className="text-[11px] text-muted-foreground">{k.label}</div>
            <div className="text-lg font-bold text-primary">{k.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-primary/20 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-primary">Bottles Delivered by Flavour</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byFlavour}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="flavour" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="bottles" radius={[4, 4, 0, 0]}>{byFlavour.map((_, i) => <Cell key={i} fill={GREENS[i % GREENS.length]} />)}</Bar></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border border-primary/20 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-primary">Category Distribution</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={byCategory} dataKey="bottles" nameKey="category" cx="50%" cy="50%" outerRadius={90} label>
                {byCategory.map((_, i) => <Cell key={i} fill={GREENS[i % GREENS.length]} />)}
              </Pie>
              <Tooltip /><Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-primary/20 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-primary">Production vs Delivery (last 14 days)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={productionVsDelivery}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend /><Bar dataKey="produced" name="Produced" fill={GREENS[0]} radius={[4, 4, 0, 0]} /><Bar dataKey="delivered" name="Delivered" fill={GREENS[2]} radius={[4, 4, 0, 0]} /></BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-primary/20 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-primary">Predicted Demand — Next 7 Days (per flavour)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={predictedDemand}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="flavour" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="predicted" name="Predicted bottles" radius={[4, 4, 0, 0]}>{predictedDemand.map((_, i) => <Cell key={i} fill={GREENS[i % GREENS.length]} />)}</Bar></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border border-primary/20 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-primary">Payment Status</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={paymentStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                <Cell fill={GREENS[0]} /><Cell fill="#cbd5d1" />
              </Pie>
              <Tooltip /><Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-primary/20 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-primary">Entries &amp; Revenue Trend (last 14 days)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={dailyEntries}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend /><Area type="monotone" dataKey="revenue" name="Revenue ₹" stroke={GREENS[0]} fill={GREENS[3]} /><Area type="monotone" dataKey="entries" name="Entries" stroke={GREENS[2]} fill={GREENS[4]} /></AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border border-primary/20 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-primary">Top Hotels by Bottles</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={topHotels} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} /><Tooltip /><Bar dataKey="bottles" radius={[0, 4, 4, 0]}>{topHotels.map((_, i) => <Cell key={i} fill={GREENS[i % GREENS.length]} />)}</Bar></BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-primary/20 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-primary">Demand Prediction — Next 7 Days (per day)</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={weeklyForecast}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="weekday" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="expected" name="Expected bottles" radius={[4, 4, 0, 0]} fill={GREENS[3]} /></BarChart>
        </ResponsiveContainer>
        <table className="mt-3 w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Day</th><th className="p-2 text-right">Expected Bottles</th></tr></thead>
          <tbody>
            {weeklyForecast.map((d) => (
              <tr key={d.date} className="border-t border-primary/10">
                <td className="p-2">{d.date}</td>
                <td className="p-2">{d.weekday}</td>
                <td className="p-2 text-right font-semibold text-primary">{d.expected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-xl border border-primary/20 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-primary">Future Prediction — per Flavour (next 7 days)</h3>
        <div className="grid gap-4 lg:grid-cols-3">
          {flavourForecast.map((cat) => (
            <div key={cat.category} className="rounded-lg border border-primary/15 p-3">
              <h4 className="mb-2 text-xs font-bold uppercase text-primary">{cat.category}</h4>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr><th className="p-1 text-left">Flavour</th><th className="p-1 text-right">Predicted</th></tr></thead>
                <tbody>
                  {cat.flavours.map((f) => (
                    <tr key={f.flavour} className="border-t border-primary/10"><td className="p-1">{f.flavour}</td><td className="p-1 text-right font-semibold text-primary">{f.predicted}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {prediction && (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-primary">Demand Summary</h3>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{prediction}</pre>
        </div>
      )}

      {(narrativeLoading || narrative || narrativeError) && (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
            <Sparkles className="h-4 w-4" /> AI Narrative
          </h3>
          {narrativeLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Writing narrative…
            </div>
          )}
          {!narrativeLoading && narrative && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{narrative}</p>
          )}
          {!narrativeLoading && narrativeError && (
            <div className="flex items-start gap-2 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {narrativeError}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}