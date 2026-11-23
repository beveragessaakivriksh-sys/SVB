import { describe, expect, it } from "vitest";
import {
  availabilityTotals,
  buildAvailabilityRows,
  buildDailyOrderDetail,
  buildDemandMap,
  buildGrid,
  buildOpeningStockGrid,
  buildProductionPlan,
  openingStockTotals,
  productKey,
  productionPlanTotals,
  sumQuantities,
  toOpeningStockMap,
  toQuantityMap,
} from "../productionUtils";

const DATE = "2026-11-17";

const productList = [
  { category: "Goli Fizz", flavour: "Orange" },
  { category: "Goli Fizz", flavour: "Lemon" },
  { category: "Petbottle", flavour: "Cola" },
  { category: "Goli Blast", flavour: "Grape" },
];

const orderItem = (category, flavour, crates = 0, loose = 0) => ({ category, flavour, crates, loose });
const billItem = orderItem;

describe("production grid", () => {
  it("uses a category|flavour key", () => {
    expect(productKey("Goli Fizz", "Orange")).toBe("Goli Fizz|Orange");
  });

  it("keeps saved quantities while following the current product list", () => {
    const grid = buildGrid(productList, [
      { category: "Goli Fizz", flavour: "Orange", quantity: 12 },
      { category: "Goli Blast", flavour: "Grape", quantity: "7" },
      { category: "Retired", flavour: "Flavour", quantity: 99 },
    ]);
    expect(grid).toHaveLength(productList.length);
    expect(grid[0]).toMatchObject({ category: "Goli Fizz", flavour: "Orange", quantity: 12 });
    expect(grid[3]).toMatchObject({ category: "Goli Blast", flavour: "Grape", quantity: 7 });
    expect(grid.some((row) => row.category === "Retired")).toBe(false);
  });

  it("maps and sums quantities, including numeric strings and duplicate rows", () => {
    const entries = [
      { category: "Goli Fizz", flavour: "Orange", quantity: "4" },
      { category: "Goli Fizz", flavour: "Orange", quantity: 3 },
      { category: "Petbottle", flavour: "Cola", quantity: 6 },
    ];
    expect(toQuantityMap(entries)[productKey("Goli Fizz", "Orange")]).toBe(7);
    expect(sumQuantities(entries)).toBe(13);
  });
});

describe("next-day demand", () => {
  it("counts a linked invoice once instead of the order and invoice twice", () => {
    const orders = [
      { id: "o1", order_date: DATE, bill_id: "b1", items: [orderItem("Goli Fizz", "Orange", 99, 0)] },
      { id: "o2", order_date: DATE, invoice_number: "INV-2", items: [orderItem("Petbottle", "Cola", 99, 0)] },
      { id: "o3", order_date: DATE, items: [orderItem("Goli Fizz", "Lemon", 1, 2)] },
      { id: "o4", order_date: "2026-11-18", items: [orderItem("Goli Blast", "Grape", 10, 0)] },
    ];
    const bills = [
      { id: "b1", invoice_number: "INV-1", invoice_date: DATE, items: [billItem("Goli Fizz", "Orange", 2, 3)] },
      { id: "b2", invoice_number: "INV-2", invoice_date: DATE, items: [billItem("Petbottle", "Cola", 1, 5)] },
      { id: "b3", invoice_number: "INV-3", invoice_date: DATE, items: [billItem("Goli Blast", "Grape", 1, 0)] },
    ];
    const demand = buildDemandMap({ orders, bills, date: DATE });
    expect(demand[productKey("Goli Fizz", "Orange")]).toBe(2 * 24 + 3);
    expect(demand[productKey("Petbottle", "Cola")]).toBe(1 * 30 + 5);
    expect(demand[productKey("Goli Fizz", "Lemon")]).toBe(1 * 24 + 2);
    expect(demand[productKey("Goli Blast", "Grape")]).toBe(1 * 24);
  });

  it("counts an invoice once even when two orders link to it", () => {
    const demand = buildDemandMap({
      orders: [
        { id: "o1", order_date: DATE, bill_id: "b1", items: [orderItem("Goli Fizz", "Orange", 9, 0)] },
        { id: "o2", order_date: DATE, bill_id: "b1", items: [orderItem("Goli Fizz", "Orange", 9, 0)] },
      ],
      bills: [{ id: "b1", invoice_date: DATE, items: [billItem("Goli Fizz", "Orange", 1, 4)] }],
      date: DATE,
    });
    expect(demand[productKey("Goli Fizz", "Orange")]).toBe(24 + 4);
  });

  it("falls back to order items when the linked invoice has no items", () => {
    const demand = buildDemandMap({
      orders: [{ id: "o1", order_date: DATE, bill_id: "b1", items: [orderItem("Goli Fizz", "Orange", 1, 0)] }],
      bills: [{ id: "b1", invoice_date: DATE, items: [] }],
      date: DATE,
    });
    expect(demand[productKey("Goli Fizz", "Orange")]).toBe(24);
  });

  it("does not depend on an order id being present", () => {
    const demand = buildDemandMap({
      orders: [{ order_date: DATE, items: [orderItem("Petbottle", "Cola", 1, 1)] }],
      bills: [{ invoice_date: DATE, items: [orderItem("Goli Fizz", "Lemon", 0, 5)] }],
      date: DATE,
    });
    expect(demand[productKey("Petbottle", "Cola")]).toBe(31);
    expect(demand[productKey("Goli Fizz", "Lemon")]).toBe(5);
  });

  it("returns no demand without a date", () => {
    expect(buildDemandMap({ orders: [], bills: [] })).toEqual({});
  });
});

describe("availability", () => {
  const produced = { [productKey("Goli Fizz", "Orange")]: 10 };
  const closing = { [productKey("Goli Fizz", "Orange")]: 5, [productKey("Goli Fizz", "Lemon")]: 5 };
  const demand = {
    [productKey("Goli Fizz", "Orange")]: 12,
    [productKey("Goli Fizz", "Lemon")]: 5,
    [productKey("Petbottle", "Cola")]: 4,
  };

  it("calculates available stock, shortfall, and status per product", () => {
    const rows = buildAvailabilityRows({ productList, produced, closing, demand });
    expect(rows.find((row) => row.key === productKey("Goli Fizz", "Orange"))).toMatchObject({ available: 3, shortfall: 0, status: "ok" });
    expect(rows.find((row) => row.key === productKey("Goli Fizz", "Lemon"))).toMatchObject({ available: 0, shortfall: 0, status: "tight" });
    expect(rows.find((row) => row.key === productKey("Petbottle", "Cola"))).toMatchObject({ available: -4, shortfall: 4, status: "short" });
    expect(rows.find((row) => row.key === productKey("Goli Blast", "Grape"))).toMatchObject({ available: 0, shortfall: 0, status: "idle" });
  });

  it("totals every column", () => {
    const rows = buildAvailabilityRows({ productList, produced, closing, demand });
    expect(availabilityTotals(rows)).toEqual({ produced: 10, closing: 10, ordered: 21, available: -1, shortfall: 4 });
  });
});

describe("morning stock and production plan", () => {
  it("converts crates + loose using 24/30 bottles per crate", () => {
    const grid = buildOpeningStockGrid(productList, [
      { category: "Goli Fizz", flavour: "Orange", crates: 2, loose: 5 },
      { category: "Petbottle", flavour: "Cola", crates: 1, loose: 3 },
    ]);
    const map = toOpeningStockMap(grid);
    expect(map[productKey("Goli Fizz", "Orange")]).toEqual({ crates: 2, loose: 5, bottles: 53 });
    expect(map[productKey("Petbottle", "Cola")]).toEqual({ crates: 1, loose: 3, bottles: 33 });
    expect(openingStockTotals(grid)).toEqual({ crates: 3, loose: 8, bottles: 86 });
  });

  it("calculates pending production after subtracting opening stock", () => {
    const opening = toOpeningStockMap(
      buildOpeningStockGrid(productList, [
        { category: "Goli Fizz", flavour: "Orange", crates: 1, loose: 0 },
        { category: "Petbottle", flavour: "Cola", crates: 1, loose: 0 },
      ])
    );
    const demand = {
      [productKey("Goli Fizz", "Orange")]: 50,
      [productKey("Petbottle", "Cola")]: 30,
      [productKey("Goli Fizz", "Lemon")]: 10,
    };
    const plan = buildProductionPlan({ productList, opening, demand });
    expect(plan.find((row) => row.key === productKey("Goli Fizz", "Orange"))).toMatchObject({
      ordered: 50, openingBottles: 24, pending: 26, pendingCrates: 1, pendingLoose: 2, status: "short",
    });
    expect(plan.find((row) => row.key === productKey("Petbottle", "Cola"))).toMatchObject({ pending: 0, status: "ok" });
    expect(productionPlanTotals(plan)).toEqual({ ordered: 90, openingBottles: 54, pending: 36, shortLines: 2 });
  });

  it("builds one order detail row per order line with the party label", () => {
    const rows = buildDailyOrderDetail({
      date: DATE,
      orders: [
        { id: "o1", internal_invoice_number: "INT-0001", order_date: DATE, display_name: "Hotel A", items: [orderItem("Goli Fizz", "Orange", 2, 3), orderItem("Petbottle", "Cola", 0, 0)] },
        { id: "o2", internal_invoice_number: "INT-0002", order_date: DATE, display_name: "Dist Hotel B", items: [orderItem("Petbottle", "Cola", 1, 2)] },
      ],
      partyLabel: (order) => ({ name: order.display_name, type: order.id === "o2" ? "Distributor" : "Customer" }),
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.orderNo === "INT-0001")).toMatchObject({ partyName: "Hotel A", partyType: "Customer", bottles: 51 });
    expect(rows.find((row) => row.orderNo === "INT-0002")).toMatchObject({ partyType: "Distributor", bottles: 32 });
  });
});
