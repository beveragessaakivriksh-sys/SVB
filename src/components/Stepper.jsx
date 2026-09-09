import { Minus, Plus } from "lucide-react";

export function Stepper({ value, onChange, min = 0, step = 1 }) {
  const v = Number(value) || 0;
  const set = (n) => onChange(Math.max(min, n));
  const btn = "h-11 w-11 flex items-center justify-center text-primary hover:bg-primary/10 transition-colors select-none";
  return (
    <div className="inline-flex items-center rounded-lg border border-primary/30 bg-white overflow-hidden select-none">
      <button type="button" onClick={() => set(v - step)} className={`${btn} border-r border-primary/20`} aria-label="Decrease">
        <Minus className="h-4 w-4" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={v}
        onChange={(e) => set(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
        className="h-11 w-12 text-center text-sm font-medium bg-transparent outline-none"
      />
      <button type="button" onClick={() => set(v + step)} className={`${btn} border-l border-primary/20`} aria-label="Increase">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}