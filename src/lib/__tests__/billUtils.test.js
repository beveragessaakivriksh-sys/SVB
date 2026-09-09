import { describe, it, expect } from "vitest";
import {
  itemBottles,
  itemAmount,
  computeBillTotals,
  padNumber,
  formatInvoiceNumber,
  bottlesToCrateLoose,
  balanceDue,
  isPartialPayment,
} from "@/lib/billUtils";

describe("itemBottles", () => {
  it("converts crates + loose to bottles for a 24/crate category", () => {
    expect(itemBottles({ category: "Goli Fizz", crates: 2, loose: 5 })).toBe(2 * 24 + 5);
  });

  it("converts crates + loose to bottles for a 30/crate category (Petbottle)", () => {
    expect(itemBottles({ category: "Petbottle", crates: 1, loose: 3 })).toBe(30 + 3);
  });

  it("treats missing/non-numeric fields as zero", () => {
    expect(itemBottles({ category: "Goli Fizz" })).toBe(0);
    expect(itemBottles({ category: "Goli Fizz", crates: "abc", loose: "xyz" })).toBe(0);
  });
});

describe("itemAmount", () => {
  it("multiplies bottle count by rate and rounds to 2dp", () => {
    expect(itemAmount({ category: "Goli Fizz", crates: 1, loose: 0, rate: 10.005 })).toBeCloseTo(240.12, 2);
  });
});

describe("computeBillTotals", () => {
  const items = [
    { category: "Goli Fizz", crates: 1, loose: 0, rate: 10 }, // 24 bottles * 10 = 240
    { category: "Petbottle", crates: 1, loose: 0, rate: 20 }, // 30 bottles * 20 = 600
  ];

  it("sums item amounts with no GST", () => {
    const totals = computeBillTotals(items, false);
    expect(totals.subtotal).toBe(840);
    expect(totals.tax).toBe(0);
    expect(totals.total).toBe(840);
  });

  it("adds CGST+SGST on top of subtotal when has_gst is true", () => {
    const totals = computeBillTotals(items, true);
    expect(totals.subtotal).toBe(840);
    expect(totals.tax).toBeGreaterThan(0);
    expect(totals.total).toBe(+(totals.subtotal + totals.tax).toFixed(2));
  });
});

describe("padNumber / formatInvoiceNumber", () => {
  it("left-pads with zeros to the given width", () => {
    expect(padNumber(7, 4)).toBe("0007");
    expect(padNumber(1234, 4)).toBe("1234");
  });

  it("defaults to 4-digit padding when none given", () => {
    expect(padNumber(7)).toBe("0007");
  });

  it("builds an invoice number from a series prefix + padded number", () => {
    expect(formatInvoiceNumber({ prefix: "INV-", padding: 4 }, 42)).toBe("INV-0042");
  });
});

describe("bottlesToCrateLoose", () => {
  it("splits bottle count into crates + remainder", () => {
    expect(bottlesToCrateLoose(53)).toEqual({ crates: 2, loose: 5 });
  });

  it("clamps negative/invalid input to zero", () => {
    expect(bottlesToCrateLoose(-10)).toEqual({ crates: 0, loose: 0 });
    expect(bottlesToCrateLoose(NaN)).toEqual({ crates: 0, loose: 0 });
  });

  it("supports a custom crate size (e.g. 30 for Petbottle)", () => {
    expect(bottlesToCrateLoose(33, 30)).toEqual({ crates: 1, loose: 3 });
  });
});

describe("balanceDue", () => {
  it("is zero once payment_status is completed, regardless of paid_amount", () => {
    expect(balanceDue({ total: 500, paid_amount: 0, payment_status: "completed" })).toBe(0);
  });

  it("is total minus paid while pending", () => {
    expect(balanceDue({ total: 500, paid_amount: 200, payment_status: "pending" })).toBe(300);
  });

  it("never goes negative", () => {
    expect(balanceDue({ total: 500, paid_amount: 900, payment_status: "pending" })).toBe(0);
  });
});

describe("isPartialPayment", () => {
  it("is true when pending with some amount already paid", () => {
    expect(isPartialPayment({ payment_status: "pending", paid_amount: 100 })).toBe(true);
  });

  it("is false when nothing has been paid yet", () => {
    expect(isPartialPayment({ payment_status: "pending", paid_amount: 0 })).toBe(false);
  });

  it("is false once completed", () => {
    expect(isPartialPayment({ payment_status: "completed", paid_amount: 100 })).toBe(false);
  });
});
