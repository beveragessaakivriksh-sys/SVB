// Shared renderer for the landscape summary printouts (Orders summary and the
// Bill Entries production summary).
//
// Everything is drawn at TWICE the size of the old portrait summary — fonts,
// row heights, line weights — and is never squeezed to fit: when there are
// more hotels than fit on a page the table continues on the next page (with
// its header repeated), and when there are more flavours / products than fit
// across the page width the extra columns continue in a further table.

const S = 2; // size multiplier versus the old portrait summary

export const SUMMARY_SCALE = S;
export const PAGE_MARGIN = 10;

const BODY_FS = 9 * S;        // 18pt  numbers, headers, totals
const LEAD_FS = 7 * S;        // 14pt  hotel names
const HEAD_FS = 9 * S;        // 18pt  category / table headings
const BODY_STEP = 7.4;        // mm between lines of 18pt text
const LEAD_STEP = 6.2;        // mm between lines of 14pt text
const BOLD_LINE = 0.4 * S;    // 0.8mm
const LIGHT_LINE = 0.1 * S;   // 0.2mm
const SUB_W = 7 * S;          // 14mm per Cr / Lo sub-column

export const SUMMARY_FONT_SIZES = { title: 14 * S, body: BODY_FS, lead: LEAD_FS };

// Opens the browser print dialog for a jsPDF document (via a hidden iframe).
export function printPdfDirect(pdf) {
  const url = pdf.output("bloburl");
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.src = url;
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      window.open(url, "_blank");
    }
  };
  document.body.appendChild(iframe);
  setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 60000);
}

// spec = {
//   title: "Goli Fizz",                       (optional heading above the table)
//   lead:  [{ header: "Hotel" }, { header: "MRP" }],   first is the wrapping name column
//   cols:  [{ header: "Jeera", subs: ["Cr", "Lo"] }, ...],   chunked across pages if too wide
//   total: { header: "Total", subs: ["Cr", "Lo"] } | null,
//   rows:  [{ lead: ["Hotel A", "Rs. 120"], cells: [["2", "3"], ...], total: ["4", "6"] }],
//   footer:{ lead: ["Total Cr/Lo", ""], cells: [...], total: [...] } | null,
// }
// Returns the y position just below the table.
export function renderGridTable(pdf, spec, startY) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const M = PAGE_MARGIN;
  const bottom = pageH - M;
  const availW = pageW - 2 * M;
  const rows = spec.rows || [];
  const footer = spec.footer || null;
  const lead = spec.lead || [{ header: "" }];
  const cols = spec.cols || [];
  const total = spec.total || null;
  const subsOf = (g) => (g && g.subs ? g.subs : null);

  const width = (str, size, style = "normal") => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    return pdf.getTextWidth(String(str));
  };
  const widestWord = (str, size) =>
    Math.max(0, ...String(str).split(/\s+/).map((w) => width(w, size)));
  // A header may be a string (wrapped to fit) or an array of ready-made lines.
  const headerWidth = (h) =>
    Array.isArray(h) ? Math.max(0, ...h.map((l) => width(l, BODY_FS))) : widestWord(h, BODY_FS);
  const wrap = (str, w, size, style = "normal") => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    return pdf.splitTextToSize(String(str), w);
  };

  // ---- column widths (never narrower than the doubled size needs)
  // (the footer label is drawn bold, so it is measured bold)
  const nameW = Math.max(
    width(lead[0].header, LEAD_FS),
    ...rows.map((r) => width(r.lead[0], LEAD_FS)),
    footer ? width(footer.lead[0], LEAD_FS, "bold") : 0
  );
  const leadW = [Math.min(72, Math.max(56, nameW + 6))];
  for (let k = 1; k < lead.length; k++) {
    const vals = rows.map((r) => r.lead[k] ?? "").concat(footer ? [footer.lead[k] ?? ""] : []);
    leadW.push(Math.max(26, width(lead[k].header, BODY_FS) + 6, ...vals.map((v) => width(v, BODY_FS) + 6)));
  }
  // width of a data column = its header's widest word, or its widest number
  // (bold, since totals are bold) plus padding — whichever is larger.
  const groupW = (g, valuesOf) => {
    const n = subsOf(g) ? g.subs.length : 1;
    const nums = [];
    rows.forEach((r) => (valuesOf(r) || []).forEach((v) => nums.push(width(v ?? "", BODY_FS, "bold"))));
    if (footer) (valuesOf(footer) || []).forEach((v) => nums.push(width(v ?? "", BODY_FS, "bold")));
    const leaf = Math.max(subsOf(g) ? SUB_W : 22, ...nums.map((w) => w + 4));
    return Math.max(n * leaf, headerWidth(g.header) + 6);
  };
  const gW = cols.map((g, i) => groupW(g, (r) => r.cells[i]));
  const totalW = total ? groupW(total, (r) => r.total) : 0;
  const leadTotalW = leadW.reduce((a, b) => a + b, 0);

  // ---- split the data columns into chunks that fit the page width
  const capacity = availW - leadTotalW;
  const chunks = [];
  let cur = [];
  let used = 0;
  cols.forEach((g, i) => {
    if (cur.length && used + gW[i] > capacity) { chunks.push(cur); cur = []; used = 0; }
    cur.push(i);
    used += gW[i];
  });
  if (cur.length || chunks.length === 0) chunks.push(cur);
  // The Total column goes on the last table only; if it doesn't fit beside
  // that table's columns, the last column moves to a table of its own.
  if (total) {
    const last = chunks[chunks.length - 1];
    const lastUsed = last.reduce((a, i) => a + gW[i], 0);
    if (last.length > 1 && lastUsed + totalW > capacity) {
      chunks[chunks.length - 1] = last.slice(0, -1);
      chunks.push([last[last.length - 1]]);
    }
  }

  const rowHeight = (r, bold = false) => {
    const k = wrap(r.lead[0], leadW[0] - 5, LEAD_FS, bold ? "bold" : "normal").length;
    return Math.max(10, k * LEAD_STEP + 3.8);
  };

  let y = startY;

  chunks.forEach((idxs, ci) => {
    const isLast = ci === chunks.length - 1;
    const groups = idxs.map((i) => cols[i]);
    const gws = idxs.map((i) => gW[i]);

    // x positions of every column boundary
    const xs = [M];
    leadW.forEach((w) => xs.push(xs[xs.length - 1] + w));
    gws.forEach((w) => xs.push(xs[xs.length - 1] + w));
    if (isLast && total) xs.push(xs[xs.length - 1] + totalW);
    const right = xs[xs.length - 1];

    // header layout
    const allHeaders = [...groups, ...(isLast && total ? [total] : [])];
    const headLines = allHeaders.map((g, k) => {
      const w = (k < groups.length ? gws[k] : totalW);
      return Array.isArray(g.header) ? g.header.map(String) : wrap(g.header, w - 3, BODY_FS);
    });
    const maxHeadLines = Math.max(1, ...headLines.map((l) => l.length));
    const anySubs = allHeaders.some((g) => subsOf(g));
    const row1H = maxHeadLines * BODY_STEP + 3;
    const row2H = anySubs ? 9 : 0;
    const headH = row1H + row2H;

    const heading = spec.title
      ? (chunks.length > 1 ? `${spec.title} (columns ${ci + 1} of ${chunks.length})` : spec.title)
      : "";

    const hline = (yy, bold) => {
      pdf.setDrawColor(bold ? 0 : 205);
      pdf.setLineWidth(bold ? BOLD_LINE : LIGHT_LINE);
      pdf.line(M, yy, right, yy);
    };

    let segTop = 0;
    const beginSegment = (continued) => {
      if (heading) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(HEAD_FS);
        pdf.setTextColor(0);
        pdf.text(continued ? `${heading} — continued` : heading, M, y + 6);
        y += 10;
      }
      segTop = y;
      hline(y, true);

      pdf.setTextColor(0);
      // lead headers span the whole header block
      lead.forEach((l, k) => {
        const size = k === 0 ? LEAD_FS : BODY_FS;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(size);
        const base = y + headH / 2 + (k === 0 ? 1.8 : 2.3);
        if (k === 0) pdf.text(String(l.header), xs[0] + 2.5, base);
        else pdf.text(String(l.header), (xs[k] + xs[k + 1]) / 2, base, { align: "center" });
      });
      // data / total headers
      allHeaders.forEach((g, k) => {
        const x0 = xs[lead.length + k];
        const x1 = xs[lead.length + k + 1];
        const lines = headLines[k];
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(BODY_FS);
        const top = y + (row1H - lines.length * BODY_STEP) / 2;
        lines.forEach((ln, li) => pdf.text(ln, (x0 + x1) / 2, top + 5.4 + li * BODY_STEP, { align: "center" }));
        const subs = subsOf(g);
        if (subs) {
          const lw = (x1 - x0) / subs.length;
          subs.forEach((sl, si) => pdf.text(String(sl), x0 + lw * si + lw / 2, y + row1H + 6.2, { align: "center" }));
        }
      });
      y += headH;
      hline(y, true);
    };

    const endSegment = () => {
      hline(y, true);
      pdf.setDrawColor(0);
      pdf.setLineWidth(BOLD_LINE);
      xs.forEach((x) => pdf.line(x, segTop, x, y));
    };

    const drawRow = (r, bold, h) => {
      pdf.setTextColor(0);
      // hotel / label column (wraps onto more lines, never shrinks)
      const lines = wrap(r.lead[0], leadW[0] - 5, LEAD_FS, bold ? "bold" : "normal");
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(LEAD_FS);
      const block = lines.length * LEAD_STEP;
      const first = y + (h - block) / 2 + 4.4;
      lines.forEach((ln, li) => pdf.text(ln, xs[0] + 2.5, first + li * LEAD_STEP));
      // other lead columns (e.g. MRP)
      pdf.setFontSize(BODY_FS);
      for (let k = 1; k < lead.length; k++) {
        const v = r.lead[k] ?? "";
        if (v !== "") pdf.text(String(v), (xs[k] + xs[k + 1]) / 2, y + h / 2 + 2.3, { align: "center" });
      }
      // data columns
      const put = (g, vals, x0, x1, b) => {
        pdf.setFont("helvetica", b ? "bold" : "normal");
        pdf.setFontSize(BODY_FS);
        const subs = subsOf(g);
        const n = subs ? subs.length : 1;
        const lw = (x1 - x0) / n;
        for (let s = 0; s < n; s++) {
          pdf.text(String((vals && vals[s]) ?? ""), x0 + lw * s + lw / 2, y + h / 2 + 2.3, { align: "center" });
        }
      };
      groups.forEach((g, k) => put(g, r.cells[idxs[k]], xs[lead.length + k], xs[lead.length + k + 1], bold));
      if (isLast && total) put(total, r.total, xs[lead.length + groups.length], xs[lead.length + groups.length + 1], true);
    };

    // Keep a table together when it can: if it doesn't fit in the space left
    // on this page but WOULD fit on a fresh one, start it on a new page. A
    // table taller than a whole page just flows across pages (header repeated).
    const bodyH = rows.reduce((a, r) => a + rowHeight(r), 0) + (footer ? Math.max(10, rowHeight(footer, true)) : 0);
    const wholeH = (heading ? 10 : 0) + headH + bodyH + 2;
    const firstH = rows.length ? rowHeight(rows[0]) : 10;
    const fitsOnFreshPage = wholeH <= bottom - M;
    if (y > M + 0.5 && (fitsOnFreshPage ? y + wholeH > bottom : y + (heading ? 10 : 0) + headH + firstH > bottom)) {
      pdf.addPage();
      y = M;
    }
    beginSegment(false);

    rows.forEach((r, ri) => {
      const h = rowHeight(r);
      if (y + h > bottom) {
        endSegment();
        pdf.addPage();
        y = M;
        beginSegment(true);
      }
      drawRow(r, false, h);
      y += h;
      if (ri < rows.length - 1) hline(y, false);
      else hline(y, true);
    });

    if (footer) {
      const fh = Math.max(10, rowHeight(footer, true));
      if (y + fh > bottom) {
        endSegment();
        pdf.addPage();
        y = M;
        beginSegment(true);
      }
      drawRow(footer, true, fh);
      y += fh;
    }

    endSegment();
    y += 8;
  });

  return y;
}

// ---------------------------------------------------------------------------
// Orders tab — "Summary" printout: one table per category (Goli Fizz, Goli
// Blast, Petbottle…), hotels down the side, crates / loose per flavour across.
// `groupedSummary` and `flavourTotals` are the same objects the on-screen
// summary uses.
export function buildOrdersSummaryPdf(pdf, { title, categories, flavoursByCategory, groupedSummary, flavourTotals }) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(SUMMARY_FONT_SIZES.title);
  pdf.setTextColor(0);
  pdf.text(title, PAGE_MARGIN, 18);
  let y = 28;

  const n = (v) => String(Number(v) || 0);
  categories.forEach((cat) => {
    const hotels = Object.entries(groupedSummary[cat] || {});
    if (hotels.length === 0) return;
    const flavs = flavoursByCategory(cat);

    const rows = hotels.map(([hotel, h]) => {
      let cr = 0;
      let lo = 0;
      Object.values(h.products || {}).forEach((p) => {
        cr += Number(p.crates) || 0;
        lo += Number(p.loose) || 0;
      });
      return {
        lead: [hotel, `Rs. ${Number(h.mrp || 0).toFixed(0)}`],
        cells: flavs.map((fl) => {
          const p = h.products[fl];
          return p ? [n(p.crates), n(p.loose)] : ["-", "-"];
        }),
        total: [String(cr), String(lo)],
      };
    });

    const ft = flavourTotals[cat] || {};
    let grandCr = 0;
    let grandLo = 0;
    Object.values(ft).forEach((t) => { grandCr += t.crates; grandLo += t.loose; });

    y = renderGridTable(pdf, {
      title: cat,
      lead: [{ header: "Hotel" }, { header: "MRP" }],
      cols: flavs.map((fl) => ({ header: fl, subs: ["Cr", "Lo"] })),
      total: { header: "Total", subs: ["Cr", "Lo"] },
      rows,
      footer: {
        lead: ["Total Cr/Lo", ""],
        cells: flavs.map((fl) => {
          const t = ft[fl] || { crates: 0, loose: 0 };
          return [String(t.crates), String(t.loose)];
        }),
        total: [String(grandCr), String(grandLo)],
      },
    }, y);
  });
}

// ---------------------------------------------------------------------------
// Bill Entries tab — "Summary" printout: total crates per hotel and product.
// `matrix[hotel][product]` / `totals[product]` come from BillSummary.
export function buildBillSummaryPdf(pdf, { title, subtitle, hotels, products, matrix, totals }) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(SUMMARY_FONT_SIZES.title);
  pdf.setTextColor(0);
  pdf.text(title, PAGE_MARGIN, 18);
  if (subtitle) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(SUMMARY_FONT_SIZES.lead);
    pdf.text(subtitle, PAGE_MARGIN, 27);
  }

  // "Goli Fizz - Jeera" -> two header lines: category above flavour
  const headerOf = (p) => {
    const i = p.indexOf(" - ");
    return i > 0 ? [p.slice(0, i), p.slice(i + 3)] : p;
  };
  const rows = hotels.map((h) => {
    const cells = products.map((p) => [String(matrix[h]?.[p] || 0)]);
    const sum = products.reduce((s, p) => s + (matrix[h]?.[p] || 0), 0);
    return { lead: [h], cells, total: [String(sum)] };
  });
  const grand = products.reduce((s, p) => s + (totals[p] || 0), 0);

  renderGridTable(pdf, {
    title: "",
    lead: [{ header: "Hotel" }],
    cols: products.map((p) => ({ header: headerOf(p) })),
    total: { header: ["Total", "Crates"] },
    rows,
    footer: {
      lead: ["TOTAL (Production)"],
      cells: products.map((p) => [String(totals[p] || 0)]),
      total: [String(grand)],
    },
  }, 34);
}
