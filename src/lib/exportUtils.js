import { SUPPLIER, BANK_NOTES, TERMS_GST, TERMS_NON_GST, CGST_RATE, SGST_RATE, HSN_SAC } from "./constants";

const FALSE = "FALSE";
const NO = "NO";
const ZERO = 0;

export const GST_ZOHO_COLUMNS = [
  "Invoice Date", "Invoice Number", "Issued Date", "Invoice Status", "Customer Name",
  "Place of Supply", "Place of Supply(With State Code)", "GST Treatment", "Is Inclusive Tax",
  "Is Export Without LUT/Bond", "Tax Collected From Customer", "Due Date", "Currency Code",
  "Exchange Rate", "Discount Type", "Is Discount Before Tax", "Template Name",
  "Entity Discount Percent", "TDS Calculation Type", "TDS Percentage", "TDS Amount", "SubTotal",
  "Total", "TotalRetentionAmountFCY", "TotalRetentionAmountBCY", "Balance", "Adjustment",
  "Adjustment Description", "Payment Terms Label", "Notes", "Terms & Conditions", "Invoice Type",
  "Entity Discount Amount", "Shipping Charge", "Item Name", "Quantity", "Discount",
  "Discount Amount", "Item Total", "Item Price", "PayPal", "Authorize.Net", "Google Checkout",
  "Payflow Pro", "Stripe", "Paytm", "2Checkout", "Braintree", "Forte", "WorldPay", "Payments Pro",
  "Square", "WePay", "Razorpay", "ICICI EazyPay", "GoCardless", "Partial Payments", "Billing Attention",
  "Billing Address", "Billing Street2", "Billing City", "Billing State", "Billing Country",
  "Billing Code", "Shipping Attention", "Shipping Address", "Shipping Street2", "Shipping City",
  "Shipping State", "Shipping Country", "Shipping Code", "Supplier Org Name",
  "Supplier GST Registration Number", "Supplier Street Address", "Supplier City", "Supplier State",
  "Supplier Country", "Supplier ZipCode", "Supplier Phone", "Supplier E-Mail", "CGST Rate %",
  "SGST Rate %", "IGST Rate %", "CESS Rate %", "CGST(FCY)", "SGST(FCY)", "IGST(FCY)", "CESS(FCY)",
  "CGST", "SGST", "IGST", "CESS", "Item TDS Amount", "GST Identification Number (GSTIN)",
  "HSN/SAC", "Round Off", "Item Type", "Reason for issuing Debit Note", "Account", "Supply Type",
  "Item Tax", "Item Tax %", "Item Tax Amount", "Item Tax Type",
];

const PAYMENT_FLAGS = {
  PayPal: FALSE, "Authorize.Net": FALSE, "Google Checkout": FALSE, "Payflow Pro": FALSE,
  Stripe: FALSE, Paytm: FALSE, "2Checkout": FALSE, Braintree: FALSE, Forte: FALSE,
  WorldPay: FALSE, "Payments Pro": FALSE, Square: FALSE, WePay: FALSE, Razorpay: FALSE,
  "ICICI EazyPay": FALSE, GoCardless: FALSE, "Partial Payments": FALSE,
};

function esc(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(columns, rows) {
  const header = columns.map(esc).join(",");
  const body = rows.map((r) => r.map(esc).join(",")).join("\n");
  return `${header}\n${body}`;
}

export function downloadCsv(columns, rows, filename) {
  const csv = toCsv(columns, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function itemTotalBottles(item) {
  return (item.crates || 0) * 24 + (item.loose || 0);
}

export function buildGstZohoRows(bill, customer) {
  const rows = [];
  const date = bill.invoice_date;
  const common = {
    "Invoice Date": date,
    "Invoice Number": bill.invoice_number,
    "Issued Date": date,
    "Invoice Status": "Overdue",
    "Customer Name": bill.customer_name || customer?.customer_name,
    "Place of Supply": bill.place_of_supply || customer?.place_of_supply,
    "Place of Supply(With State Code)": bill.place_of_supply_state_code || customer?.place_of_supply_state_code,
    "GST Treatment": bill.gst_treatment || customer?.gst_treatment,
    "Is Inclusive Tax": FALSE,
    "Is Export Without LUT/Bond": NO,
    "Tax Collected From Customer": NO,
    "Due Date": date,
    "Currency Code": "INR",
    "Exchange Rate": 1,
    "Discount Type": "item_level",
    "Is Discount Before Tax": "TRUE",
    "Template Name": "Spreadsheet Template",
    "Entity Discount Percent": ZERO,
    "TDS Calculation Type": "item_level",
    "TDS Percentage": ZERO,
    "TDS Amount": ZERO,
    "SubTotal": "",
    "Total": "",
    "TotalRetentionAmountFCY": ZERO,
    "TotalRetentionAmountBCY": ZERO,
    "Balance": "",
    "Adjustment": ZERO,
    "Adjustment Description": "Adjustment",
    "Payment Terms Label": "Due on Receipt",
    "Notes": BANK_NOTES,
    "Terms & Conditions": TERMS_GST,
    "Invoice Type": "Invoice",
    "Entity Discount Amount": ZERO,
    "Shipping Charge": ZERO,
    "Billing Attention": bill.billing_attention || customer?.billing_attention,
    "Billing Address": bill.billing_address || customer?.billing_address,
    "Billing Street2": bill.billing_street2 || customer?.billing_street2,
    "Billing City": bill.billing_city || customer?.billing_city,
    "Billing State": bill.billing_state || customer?.billing_state,
    "Billing Country": bill.billing_country || customer?.billing_country || "India",
    "Billing Code": bill.billing_code || customer?.billing_code,
    "Shipping Attention": bill.shipping_attention || customer?.shipping_attention,
    "Shipping Address": bill.shipping_address || customer?.shipping_address,
    "Shipping Street2": bill.shipping_street2 || customer?.shipping_street2,
    "Shipping City": bill.shipping_city || customer?.shipping_city,
    "Shipping State": bill.shipping_state || customer?.shipping_state,
    "Shipping Country": bill.shipping_country || customer?.shipping_country || "India",
    "Shipping Code": bill.shipping_code || customer?.shipping_code,
    "Supplier Org Name": SUPPLIER.org_name,
    "Supplier GST Registration Number": SUPPLIER.gstin,
    "Supplier Street Address": SUPPLIER.street_address,
    "Supplier City": SUPPLIER.city,
    "Supplier State": SUPPLIER.state,
    "Supplier Country": SUPPLIER.country,
    "Supplier ZipCode": SUPPLIER.zip,
    "Supplier Phone": SUPPLIER.phone,
    "Supplier E-Mail": SUPPLIER.email,
    "CGST Rate %": CGST_RATE,
    "SGST Rate %": SGST_RATE,
    "IGST Rate %": ZERO,
    "CESS Rate %": ZERO,
    "IGST(FCY)": ZERO,
    "CESS(FCY)": ZERO,
    "IGST": ZERO,
    "CESS": ZERO,
    "Item TDS Amount": ZERO,
    "GST Identification Number (GSTIN)": bill.gstin || customer?.gstin,
    "HSN/SAC": HSN_SAC,
    "Round Off": ZERO,
    "Item Type": "goods",
    "Reason for issuing Debit Note": "Others",
    "Account": "Sales",
    "Supply Type": "Taxable",
    "Item Tax": "GST40",
    "Item Tax %": 40,
    "Item Tax Type": "Tax Group",
    ...PAYMENT_FLAGS,
  };

  (bill.items || []).forEach((item) => {
    const itemTotal = item.amount || 0;
    const cgst = +(CGST_RATE * itemTotal / 100).toFixed(2);
    const sgst = +(SGST_RATE * itemTotal / 100).toFixed(2);
    const row = { ...common };
    row["Item Name"] = item.label || `${item.category} - ${item.flavour}`;
    row["Quantity"] = itemTotalBottles(item);
    row["Discount"] = ZERO;
    row["Discount Amount"] = ZERO;
    row["Item Total"] = itemTotal;
    row["Item Price"] = item.rate || 0;
    row["CGST(FCY)"] = cgst;
    row["SGST(FCY)"] = sgst;
    row["CGST"] = cgst;
    row["SGST"] = sgst;
    row["Item Tax Amount"] = +(cgst + sgst).toFixed(2);
    rows.push(GST_ZOHO_COLUMNS.map((c) => row[c] ?? ""));
  });
  return rows;
}

export const NON_GST_COLUMNS = [
  "Invoice Number", "Invoice Date", "Invoice Status", "Customer Name", "GST Treatment",
  "Place of Supply", "Payment Terms Label", "Due Date", "Currency Code", "Item Name",
  "Quantity", "Item Price", "Terms & Conditions",
];

export function buildNonGstRows(bill, customer) {
  const rows = [];
  const date = bill.invoice_date;
  const terms = TERMS_NON_GST;
  (bill.items || []).forEach((item) => {
    const mrp = item.rate || 0;
    rows.push([
      bill.invoice_number,
      date,
      "Approved",
      bill.customer_name || customer?.customer_name,
      bill.gst_treatment || customer?.gst_treatment || "",
      bill.place_of_supply || customer?.place_of_supply || "",
      bill.payment_terms_label || customer?.payment_terms_label || "Due on Receipt",
      date,
      "INR",
      item.label || `${item.category} - ${item.flavour}`,
      itemTotalBottles(item),
      mrp,
      terms,
    ]);
  });
  return rows;
}