const TONES = {
  primary: "border-primary/20 bg-primary/5 text-primary",
  sky: "border-sky-200 bg-sky-50 text-sky-800",
  slate: "border-border bg-muted/40 text-foreground",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  red: "border-red-200 bg-red-50 text-red-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
};

export default function StatCard({ label, value, hint, icon: Icon, tone = "primary" }) {
  return (
    <div className={`rounded-xl border p-3 ${TONES[tone] || TONES.primary}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium opacity-80">{label}</div>
        {Icon && <Icon className="h-4 w-4 opacity-70" />}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] opacity-70">{hint}</div>}
    </div>
  );
}
