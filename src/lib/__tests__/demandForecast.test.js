import { describe, expect, it } from "vitest";
import { buildDemandForecast } from "../demandForecast";

const TODAY = "2026-11-15";
const isoDaysAgo = (days) => {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

function makeOrders(days = 120) {
  const orders = [];
  for (let i = days; i >= 1; i -= 1) {
    const date = isoDaysAgo(i);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0) continue;
    const count = 2 + (i % 4);
    for (let j = 0; j < count; j += 1) {
      orders.push({
        order_date: date,
        display_name: `Hotel ${j % 5}`,
        total_amount: 1000 + j * 100,
        items: [
          { category: "Goli Fizz", flavour: "Orange", crates: 2 + (i % 3), loose: 4, amount: 500 },
          { category: "Petbottle", flavour: "Cola", crates: 1, loose: 2, amount: 300 },
        ],
      });
    }
  }
  return orders;
}

describe("demandForecast", () => {
  it("learns from all order rows and produces 7-day forecasts", () => {
    const orders = makeOrders();
    const model = buildDemandForecast(orders, { today: TODAY });
    expect(model.ok).toBe(true);
    expect(model.history.orders).toBe(orders.length);
    expect(model.forecastDays).toHaveLength(7);
    expect(model.flavourForecast.length).toBeGreaterThan(0);
    expect(model.hotelForecast.length).toBeGreaterThan(0);
    expect(model.backtest).not.toBeNull();
  });

  it("gives every flavour a forecast for each of the next 7 days", () => {
    const model = buildDemandForecast(makeOrders(), { today: TODAY });
    expect(model.forecastDays).toHaveLength(7);
    expect(model.flavourForecast.every((item) => item.daily.length === 7)).toBe(true);
    const columnTotals = Array(7).fill(0);
    model.flavourForecast.forEach((item) => {
      expect(item.bottles).toBe(item.daily.reduce((total, value) => total + value, 0));
      item.daily.forEach((value, index) => { columnTotals[index] += value; });
    });
    expect(columnTotals).toEqual(model.forecastDays.map((day) => day.bottles));
  });

  it("uses 30 bottles per crate for Petbottle and 24 for the other categories", () => {
    const model = buildDemandForecast([
      {
        order_date: TODAY,
        display_name: "Test Hotel",
        items: [
          { category: "Petbottle", flavour: "Cola", crates: 1, loose: 2 },
          { category: "Goli Fizz", flavour: "Orange", crates: 1, loose: 3 },
        ],
      },
    ], { today: TODAY });
    const day = model.daily.find((entry) => entry.date === TODAY);
    expect(day.byCategory.Petbottle).toBe(32);
    expect(day.byCategory["Goli Fizz"]).toBe(27);
  });

  it("returns an empty model when there is no history", () => {
    const model = buildDemandForecast([]);
    expect(model.ok).toBe(false);
    expect(model.forecastDays).toEqual([]);
    expect(model.summaryLines[0]).toContain("No order history");
  });

  it("forecasts just the selected date with category and flavour detail", () => {
    const target = "2026-12-20";
    const model = buildDemandForecast(makeOrders(), { today: TODAY, targetDate: target });
    expect(model.ok).toBe(true);
    expect(model.targetDate).toBe(target);
    expect(model.forecastDays).toHaveLength(1);
    expect(model.forecastDays[0].date).toBe(target);
    expect(model.flavourForecast.length).toBeGreaterThan(0);
    expect(model.flavourForecast.every((item) => item.daily.length === 1)).toBe(true);
    expect(model.totals.bottles).toBe(model.forecastDays[0].bottles);
    expect(model.summaryLines.join("\n")).toContain(target);
    expect(model.categoryForecast.length).toBeGreaterThan(0);
  });
});
