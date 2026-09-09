import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export default function BillSummary({ bills }) {
  const tableRef = useRef(null);

  const { hotels, products, matrix, totals } = useMemo(() => {
    const hotelSet = new Set();
    const productSet = new Set();
    const m = {};
    bills.forEach((b) => {
      const hotel = b.customer_name || "Unknown";
      hotelSet.add(hotel);
      (b.items || []).forEach((it) => {
        const product = `${it.category} - ${it.flavour}`;
        const crates = Number(it.crates) || 0;
        if (!crates) return;
        productSet.add(product);
        m[hotel] = m[hotel] || {};
        m[hotel][product] = (m[hotel][product] || 0) + crates;
      });
    });
    const hotels = [...hotelSet].sort();
    const products = [...productSet].sort();
    const totals = {};
    products.forEach((p) => {
      totals[p] = hotels.reduce((s, h) => s + (m[h]?.[p] || 0), 0);
    });
    return { hotels, products, matrix: m, totals };
  }, [bills]);

  const downloadImage = async () => {
    if (!tableRef.current) return;
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(tableRef.current, { backgroundColor: "#ffffff", scale: 2 });
    const link = document.createElement("a");
    link.download = `production_summary_${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  if (hotels.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">No items to summarize.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-primary">Production Summary</h3>
          <p className="text-xs text-muted-foreground">Total crates per hotel &amp; flavour · {bills.length} bills</p>
        </div>
        <Button size="sm" onClick={downloadImage}><Download className="h-4 w-4 mr-2" /> Download as Image</Button>
      </div>
      <div ref={tableRef} className="overflow-x-auto rounded-xl border border-primary/20 bg-white p-4">
        <div className="mb-2 text-sm font-bold text-primary">SVB — Production Crates Summary</div>
        <table className="w-full border-collapse text-xs">
          <thead className="bg-primary/5">
            <tr>
              <th className="border border-primary/15 p-2 text-left">Hotel</th>
              {products.map((p) => (
                <th key={p} className="border border-primary/15 p-2 text-center whitespace-nowrap">{p}</th>
              ))}
              <th className="border border-primary/30 p-2 text-center bg-primary/10">Total Crates</th>
            </tr>
          </thead>
          <tbody>
            {hotels.map((h) => {
              const rowTotal = products.reduce((s, p) => s + (matrix[h]?.[p] || 0), 0);
              return (
                <tr key={h} className="hover:bg-primary/5">
                  <td className="border border-primary/15 p-2 font-medium">{h}</td>
                  {products.map((p) => (
                    <td key={p} className="border border-primary/15 p-2 text-center">{matrix[h]?.[p] || 0}</td>
                  ))}
                  <td className="border border-primary/30 p-2 text-center font-bold bg-primary/5">{rowTotal}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold bg-primary/10">
              <td className="border border-primary/30 p-2">TOTAL (Production)</td>
              {products.map((p) => (
                <td key={p} className="border border-primary/30 p-2 text-center">{totals[p]}</td>
              ))}
              <td className="border border-primary/30 p-2 text-center">{products.reduce((s, p) => s + totals[p], 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}