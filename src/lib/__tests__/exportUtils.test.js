import { describe, expect, it } from "vitest";
import { buildGstZohoRows, buildNonGstRows, GST_ZOHO_COLUMNS, NON_GST_COLUMNS, isGstExportBill, isNonGstExportBill } from "../exportUtils";

const bill = {
  invoice_number: "INV-1001",
  invoice_date: "2026-11-17",
  has_gst: true,
  customer_name: "Hotel A",
  items: [
    { category: "Goli Fizz", flavour: "Orange", crates: 2, loose: 3, rate: 10, amount: 510 },
    { category: "Petbottle", flavour: "Cola", crates: 1, loose: 4, rate: 12, amount: 408 },
  ],
};

describe("exportUtils", () => {
  it("keeps the exact Zoho column order", () => {
    expect(GST_ZOHO_COLUMNS[0]).toBe("Invoice Date");
    expect(GST_ZOHO_COLUMNS[1]).toBe("Invoice Number");
    expect(GST_ZOHO_COLUMNS).toHaveLength(87);
    expect(NON_GST_COLUMNS[0]).toBe("Invoice Number");
    expect(NON_GST_COLUMNS).toHaveLength(13);
  });

  it("uses 24 bottles per crate for Goli Fizz and 30 for Petbottle", () => {
    const rows = buildGstZohoRows(bill, { customer_name: "Hotel A" });
    expect(rows).toHaveLength(2);
    const goli = rows[0][GST_ZOHO_COLUMNS.indexOf("Quantity")];
    const pet = rows[1][GST_ZOHO_COLUMNS.indexOf("Quantity")];
    expect(goli).toBe(2 * 24 + 3);
    expect(pet).toBe(1 * 30 + 4);
  });

  it("sends GST customer bills only to the GST CSV", () => {
    expect(isGstExportBill({ has_gst: true, customer_id: "c1" })).toBe(true);
    expect(isGstExportBill({ has_gst: false, customer_id: "c1" })).toBe(false);
    // A GST-flagged distributor bill is NOT a GST export bill.
    expect(isGstExportBill({ has_gst: true, party_type: "distributor", distributor_id: "d1" })).toBe(false);
    expect(isGstExportBill({ has_gst: true, distributor_hotel_id: "h1" })).toBe(false);
  });

  it("sends non-GST bills and every distributor bill to the Non-GST CSV", () => {
    expect(isNonGstExportBill({ has_gst: false, customer_id: "c1" })).toBe(true);
    expect(isNonGstExportBill({ has_gst: true, customer_id: "c1" })).toBe(false);
    expect(isNonGstExportBill({ has_gst: false, party_type: "distributor", distributor_id: "d1" })).toBe(true);
    expect(isNonGstExportBill({ has_gst: true, party_type: "distributor", distributor_id: "d1" })).toBe(true);
    expect(isNonGstExportBill({ has_gst: true, distributor_hotel_id: "h1" })).toBe(true);
  });

  it("keeps the two CSV exports mutually exclusive", () => {
    const bills = [
      { has_gst: true, customer_id: "c1" },
      { has_gst: false, customer_id: "c2" },
      { has_gst: true, distributor_id: "d1" },
      { has_gst: false, distributor_id: "d2" },
    ];
    bills.forEach((b) => expect(isGstExportBill(b) && isNonGstExportBill(b)).toBe(false));
    expect(bills.filter(isGstExportBill)).toHaveLength(1);
    expect(bills.filter(isNonGstExportBill)).toHaveLength(3);
  });

  it("falls back to hotel or distributor names for the bill-to party", () => {
    const gst = buildGstZohoRows({ ...bill, customer_name: null }, { hotel_name: "Hotel B" });
    expect(gst[0][GST_ZOHO_COLUMNS.indexOf("Customer Name")]).toBe("Hotel B");
    const nonGst = buildNonGstRows({ ...bill, has_gst: false, customer_name: null }, { distributor_name: "Dist C" });
    expect(nonGst[0][NON_GST_COLUMNS.indexOf("Customer Name")]).toBe("Dist C");
  });
});
