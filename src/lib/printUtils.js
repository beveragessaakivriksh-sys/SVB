import { SUPPLIER, BANK_NOTES, TERMS_GST, TERMS_NON_GST, BOTTLES_PER_CRATE, bottlesPerCrate } from "./constants";

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "0.00";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function itemTotalBottles(item) {
  return (item.crates || 0) * bottlesPerCrate(item.category) + (item.loose || 0);
}

export function buildInvoiceHtml(bill, customer, { duplicate = false } = {}) {
  const isGst = bill.has_gst;
  const items = bill.items || [];
  const taxRows = isGst
    ? items
        .map((it) => {
          const cgst = +(it.amount * 0.2).toFixed(2);
          const sgst = +(it.amount * 0.2).toFixed(2);
          return { cgst, sgst };
        })
        .reduce((a, b) => ({ cgst: a.cgst + b.cgst, sgst: a.sgst + b.sgst }), { cgst: 0, sgst: 0 })
    : null;

  const subtotal = items.reduce((s, it) => s + (it.amount || 0), 0);
  const taxTotal = isGst ? +(subtotal * 0.4).toFixed(2) : 0;
  const grandTotal = subtotal + taxTotal;

  const rowsHtml = items
    .map(
      (it, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${it.label || `${it.category} - ${it.flavour}`}</td>
        <td style="text-align:center">${it.crates || 0}</td>
        <td style="text-align:center">${it.loose || 0}</td>
        <td style="text-align:center">${itemTotalBottles(it)}</td>
        <td style="text-align:right">${fmt(it.rate)}</td>
        <td style="text-align:right">${fmt(it.amount)}</td>
      </tr>`
    )
    .join("");

  const billTo = [
    bill.billing_attention || customer?.billing_attention,
    bill.billing_address || customer?.billing_address,
    bill.billing_street2 || customer?.billing_street2,
    [bill.billing_city || customer?.billing_city, bill.billing_state || customer?.billing_state, bill.billing_code || customer?.billing_code]
      .filter(Boolean)
      .join(", "),
    bill.billing_country || customer?.billing_country || "India",
  ].filter(Boolean).join("<br/>");

  const gstBlock = isGst
    ? `
    <div class="kv"><span>GSTIN:</span><strong>${bill.gstin || customer?.gstin || ""}</strong></div>
    <div class="kv"><span>GST Treatment:</span><strong>${bill.gst_treatment || customer?.gst_treatment || ""}</strong></div>
    <div class="kv"><span>Place of Supply:</span><strong>${bill.place_of_supply_state_code || customer?.place_of_supply_state_code || ""}</strong></div>`
    : "";

  const taxTable = isGst
    ? `
    <table class="tax">
      <tr><td>CGST (20%)</td><td style="text-align:right">${fmt(taxRows.cgst)}</td></tr>
      <tr><td>SGST (20%)</td><td style="text-align:right">${fmt(taxRows.sgst)}</td></tr>
      <tr class="grand"><td>Total Tax (40%)</td><td style="text-align:right">${fmt(taxTotal)}</td></tr>
    </table>`
    : "";

  const dupBanner = duplicate
    ? `<div style="text-align:center;font-weight:700;letter-spacing:2px;border:1px dashed #111;padding:6px;margin-bottom:10px">DUPLICATE COPY</div>`
    : "";

  const sigBlock = duplicate
    ? `<div class="signature"><div>Received by (Signature & Seal):</div><div class="line"></div></div>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${bill.invoice_number}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#111;margin:0;padding:32px;font-size:13px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:14px;margin-bottom:18px}
    .brand{font-size:22px;font-weight:800;letter-spacing:.5px}
    .brand small{display:block;font-size:11px;font-weight:400;color:#444;margin-top:2px}
    .inv-title{font-size:18px;font-weight:700;text-transform:uppercase}
    .grid{display:flex;gap:24px;margin-bottom:16px}
    .panel{flex:1}
    .kv{font-size:12px;margin:2px 0}
    .kv span{color:#555}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{border:1px solid #ccc;padding:7px 9px;font-size:12px}
    th{background:#f4f4f4;text-align:left;font-size:11px;text-transform:uppercase}
    .totals{display:flex;justify-content:flex-end;margin-top:14px;gap:30px}
    .tax{width:240px}
    .tax td{border:none;padding:5px 0;font-size:12px}
    .grand td{border-top:2px solid #111;font-weight:700;font-size:13px}
    .grand-total{font-size:17px;font-weight:800;border-top:3px solid #111;margin-top:6px;padding-top:6px}
    .notes{margin-top:18px;font-size:11px;color:#333;line-height:1.5}
    .notes h4{margin:0 0 4px;font-size:12px}
    .terms{font-size:11px;color:#444;margin-top:10px;line-height:1.5}
    .signature{margin-top:60px;text-align:right;font-size:12px}
    .signature .line{margin-top:40px;border-top:1px solid #111;width:220px;margin-left:auto}
    .meta{font-size:11px;color:#555;text-align:right}
    @media print{body{padding:14px}}
  </style></head>
  <body>
  ${dupBanner}
  <div class="head">
    <div>
      <div class="brand">${SUPPLIER.org_name}<small>${SUPPLIER.street_address}<br/>${SUPPLIER.city}, ${SUPPLIER.state} - ${SUPPLIER.zip}, ${SUPPLIER.country}<br/>GSTIN: ${SUPPLIER.gstin} &nbsp;|&nbsp; Ph: ${SUPPLIER.phone}<br/>${SUPPLIER.email}</small></div>
    </div>
    <div style="text-align:right">
      <div class="inv-title">${isGst ? "Tax Invoice" : "Invoice"}</div>
      <div class="meta">Invoice #: <strong>${bill.invoice_number}</strong><br/>Date: ${bill.invoice_date}<br/>${isGst ? "" : "Payment Terms: " + (bill.payment_terms_label || customer?.payment_terms_label || "Due on Receipt")}</div>
    </div>
  </div>
  <div class="grid">
    <div class="panel">
      <div style="font-weight:700;margin-bottom:4px">Bill To</div>
      <div style="font-weight:700;font-size:14px">${bill.customer_name || customer?.customer_name}</div>
      <div style="font-size:12px">${billTo}</div>
    </div>
    <div class="panel">
      ${gstBlock}
      <div class="kv"><span>Returned Crates:</span><strong>${bill.returned_crates || 0}</strong></div>
      <div class="kv"><span>Damaged Bottles:</span><strong>${bill.damaged_bottles || 0}</strong></div>
      <div class="kv"><span>Payment:</span><strong style="text-transform:capitalize">${bill.payment_status || "pending"}</strong>${bill.payment_mode ? " / " + bill.payment_mode : ""}</div>
    </div>
  </div>
  <table>
    <thead><tr><th style="width:30px">#</th><th>Item</th><th>Crates</th><th>Loose</th><th>Bottles</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#999">No items</td></tr>'}</tbody>
  </table>
  <div class="totals">
    <div>
      <table class="tax">
        <tr><td>Subtotal</td><td style="text-align:right">${fmt(subtotal)}</td></tr>
        ${taxTable}
        <tr class="grand-total"><td>Grand Total</td><td style="text-align:right">₹ ${fmt(grandTotal)}</td></tr>
      </table>
    </div>
  </div>
  <div class="notes">
    <h4>Bank Details</h4>
    ${BANK_NOTES}
  </div>
  <div class="terms">
    <strong>Terms &amp; Conditions:</strong><br/>${isGst ? TERMS_GST : TERMS_NON_GST}
  </div>
  ${sigBlock}
  </body></html>`;
}

export function printInvoiceA4(bill, customer, { duplicate = false } = {}) {
  const html = buildInvoiceHtml(bill, customer, { duplicate });
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) {
    alert("Please allow pop-ups to print the invoice.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 400);
}

export async function downloadInvoicePdf(bill, customer, { duplicate = false } = {}) {
  const html = buildInvoiceHtml(bill, customer, { duplicate });
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "794px";
  container.innerHTML = html;
  document.body.appendChild(container);
  const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#fff" });
  document.body.removeChild(container);
  const img = canvas.toDataURL("image/jpeg", 0.92);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF("p", "mm", "a4");
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const iw = canvas.width;
  const ih = canvas.height;
  const ratio = Math.min(pw / iw, ph / ih);
  const w = iw * ratio;
  const h = ih * ratio;
  pdf.addImage(img, "JPEG", (pw - w) / 2, 0, w, h);
  pdf.save(`${bill.invoice_number}.pdf`);
}

async function html2canvas(el, opts) {
  const mod = await import("html2canvas");
  return mod.default(el, opts);
}