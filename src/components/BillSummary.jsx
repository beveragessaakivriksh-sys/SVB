import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Printer, FileDown, Loader2 } from "lucide-react";
import { buildBillSummaryPdf, printPdfDirect } from "@/lib/summaryPdf";
import { useToast } from "@/components/ui/use-toast";

export default function BillSummary({ bills }) {
  const tableRef = useRef(null);
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

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

  const exportSummaryPdf = async (mode = "save") => {
    if (!hotels.length) return;
    setExporting(true);
    try {
      const { jsPDF } = await import("jspdf");
      // A4 landscape, everything at 1.5×. The renderer keeps the table on
      // one page where possible and flows it onto a second page only when
      // the selected rows/columns genuinely overflow.
      const pdf = new jsPDF("l", "mm", "a4");
      buildBillSummaryPdf(pdf, {
        title: "SVB — Production Crates Summary",
        subtitle: `${bills.length} bill(s) · ${hotels.length} hotel(s) · ${products.length} product(s) · A4 landscape · 1.5×`,
        hotels,
        products,
        matrix,
        totals,
      });

      if (mode === "print") {
        printPdfDirect(pdf);
        toast({ title: "Opening print dialog (A4 landscape)" });
        return;
      }

      pdf.save(`production_summary_${Date.now()}.pdf`);
      toast({ title: "Summary saved as PDF", description: "A4 landscape · 1.5× print size" });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not create PDF", description: e.message });
    } finally {
      setExporting(false);
    }
  };

  if (hotels.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">No items to summarize.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-primary">Production Summary</h3>
          <p className="text-xs text-muted-foreground">Total crates per hotel &amp; flavour · {bills.length} bills</p>
          <p className="text-[10px] text-muted-foreground">
            Print layout: A4 landscape, everything at 1.5× — one page where it fits, otherwise it flows onto a second page.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => exportSummaryPdf("print")} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
            Print / Save PDF
          </Button>
          <Button size="sm" variant="outline" onClick={() => exportSummaryPdf("save")} disabled={exporting}>
            <FileDown className="h-4 w-4 mr-2" /> Save PDF
          </Button>
          <Button size="sm" variant="outline" onClick={downloadImage}><Download className="h-4 w-4 mr-2" /> Download Image</Button>
        </div>
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
