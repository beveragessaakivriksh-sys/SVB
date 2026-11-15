// src/lib/demandForecast.js
//
// Order-demand forecasting that learns from ALL available order rows.
//
// Model (explainable, deterministic, no external API):
//   1. Reconstruct a complete daily history between the first order and today.
//   2. For each series (order count, bottles, each flavour/category/hotel):
//      - recency-weighted average (exponential half-life)
//      - day-of-week seasonality, shrunk toward the overall average
//      - recent exponentially-weighted level
//      - linear trend over the recent window
//   3. Forecast the next 7 days as:
//        0.55 * weekdaySeasonalLevel + 0.45 * recentEWMA
//        multiplied by a clamped trend factor.
//   4. Backtest one-step-ahead on the last 14 days (WAPE) so the UI can show
//      how well the model performs on this business's own history.
//
// Every order in the table is used for training. Older orders get less weight
// than recent ones, so the forecast adapts without ignoring the long history.

import { CATEGORIES, FLAVOURS, bottlesPerCrate } from "./constants";

const DAY_MS = 86400000;
const HISTORY_CHART_DAYS = 30;
const BACKTEST_DAYS = 14;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function localTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayNumber(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function isoFromDayNumber(n) {
  const dt = new Date(n * DAY_MS);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function addDaysISO(iso, days) {
  return isoFromDayNumber(dayNumber(iso) + days);
}

function weekdayOf(iso) {
  return new Date(dayNumber(iso) * DAY_MS).getUTCDay();
}

function weekdayLabel(iso) {
  return new Date(dayNumber(iso) * DAY_MS).toLocaleDateString("en-IN", {
    weekday: "short",
    timeZone: "UTC",
  });
}

function monthDayLabel(iso) {
  return String(iso || "").slice(5);
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value) {
  return Math.round(Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalizeOrder(order) {
  const date = String(order.order_date || order.delivery_date || order.created_at || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const items = (Array.isArray(order.items) ? order.items : [])
    .map((item) => ({
      category: item.category || "Other",
      flavour: item.flavour || "Unknown",
      crates: safeNumber(item.crates),
      loose: safeNumber(item.loose),
      amount: safeNumber(item.amount),
    }))
    .filter((item) => item.crates > 0 || item.loose > 0);

  const itemBottles = items.reduce(
    (total, item) => total + item.crates * bottlesPerCrate(item.category) + item.loose,
    0
  );
  const bottles = itemBottles || safeNumber(order.total_bottles);
  const revenue = safeNumber(order.total_amount) || items.reduce((total, item) => total + item.amount, 0);

  return {
    ...order,
    date,
    items,
    bottles,
    revenue,
    hotel: order.display_name || order.customer_name || "Unknown",
  };
}

function emptyDaily(date) {
  return {
    date,
    orders: 0,
    bottles: 0,
    revenue: 0,
    byFlavour: Object.create(null),
    byFlavourOrders: Object.create(null),
    byCategory: Object.create(null),
    byHotel: Object.create(null),
    byHotelOrders: Object.create(null),
  };
}

function buildDaily(orders, today) {
  const byDate = new Map();

  orders.forEach((order) => {
    let day = byDate.get(order.date);
    if (!day) {
      day = emptyDaily(order.date);
      byDate.set(order.date, day);
    }

    day.orders += 1;
    day.bottles += order.bottles;
    day.revenue += order.revenue;

    day.byHotel[order.hotel] = (day.byHotel[order.hotel] || 0) + order.bottles;
    day.byHotelOrders[order.hotel] = (day.byHotelOrders[order.hotel] || 0) + 1;

    const seenFlavours = new Set();
    order.items.forEach((item) => {
      const bottles = item.crates * bottlesPerCrate(item.category) + item.loose;
      if (bottles <= 0) return;

      const key = `${item.category}|${item.flavour}`;
      day.byFlavour[key] = (day.byFlavour[key] || 0) + bottles;
      day.byCategory[item.category] = (day.byCategory[item.category] || 0) + bottles;
      seenFlavours.add(key);
    });

    seenFlavours.forEach((key) => {
      day.byFlavourOrders[key] = (day.byFlavourOrders[key] || 0) + 1;
    });
  });

  const orderDates = [...byDate.keys()].sort();
  if (!orderDates.length) return { daily: [], firstDate: "", lastDate: "" };

  const firstDate = orderDates[0];
  const lastOrderDate = orderDates[orderDates.length - 1];
  const endDay = Math.max(dayNumber(lastOrderDate), dayNumber(today));
  const daily = [];

  for (let n = dayNumber(firstDate); n <= endDay; n += 1) {
    const date = isoFromDayNumber(n);
    daily.push(byDate.get(date) || emptyDaily(date));
  }

  return {
    daily,
    firstDate,
    lastDate: daily[daily.length - 1].date,
  };
}

// ---------------------------------------------------------------------------
// Core statistical model
// ---------------------------------------------------------------------------

function fitSeries(values, dates, options = {}) {
  const n = values.length;
  const halfLife = options.halfLife || 45;
  const weekdayHalfLife = options.weekdayHalfLife || 90;
  const trendWindow = options.trendWindow || 180;

  if (!n) {
    return {
      mean: 0,
      level: 0,
      slope: 0,
      weekdayMean: Array(7).fill(0),
      predict: () => 0,
    };
  }

  const lastDay = dayNumber(dates[n - 1]);

  let weightSum = 0;
  let weightedValue = 0;
  for (let i = 0; i < n; i += 1) {
    const age = Math.max(0, lastDay - dayNumber(dates[i]));
    const weight = Math.pow(0.5, age / halfLife);
    weightSum += weight;
    weightedValue += weight * values[i];
  }
  const mean = weightSum ? weightedValue / weightSum : 0;

  const dowWeight = Array(7).fill(0);
  const dowWeightedValue = Array(7).fill(0);
  for (let i = 0; i < n; i += 1) {
    const age = Math.max(0, lastDay - dayNumber(dates[i]));
    const weight = Math.pow(0.5, age / weekdayHalfLife);
    const dow = weekdayOf(dates[i]);
    dowWeight[dow] += weight;
    dowWeightedValue[dow] += weight * values[i];
  }

  const prior = 2; // shrinkage toward the overall mean
  const weekdayMean = dowWeight.map(
    (weight, dow) => (dowWeightedValue[dow] + mean * prior) / (weight + prior)
  );

  const recent = values.slice(-60);
  let level = recent.length ? recent[0] : mean;
  const alpha = 0.18;
  for (let i = 1; i < recent.length; i += 1) {
    level = alpha * recent[i] + (1 - alpha) * level;
  }

  const start = Math.max(0, n - trendWindow);
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = start; i < n; i += 1) {
    const x = i - (n - 1);
    const weight = Math.pow(0.5, (n - 1 - i) / weekdayHalfLife);
    sw += weight;
    sx += weight * x;
    sy += weight * values[i];
    sxx += weight * x * x;
    sxy += weight * x * values[i];
  }
  const denominator = sw * sxx - sx * sx;
  const slope = denominator ? (sw * sxy - sx * sy) / denominator : 0;

  const predict = (horizon, targetDate) => {
    const dow = weekdayOf(targetDate);
    const base = weekdayMean[dow] * 0.55 + level * 0.45;
    const denominator2 = Math.max(level, mean, 1);
    const trendFactor = clamp(1 + (slope * horizon) / denominator2, 0.55, 1.8);
    return Math.max(0, base * trendFactor);
  };

  return { mean, level, slope, weekdayMean, predict };
}

function backtestSeries(values, dates, days = BACKTEST_DAYS) {
  const n = values.length;
  if (n < days + 21) return null;

  let absoluteError = 0;
  let actualTotal = 0;

  for (let i = n - days; i < n; i += 1) {
    const model = fitSeries(values.slice(0, i), dates.slice(0, i));
    const predicted = model.predict(1, dates[i]);
    absoluteError += Math.abs(predicted - values[i]);
    actualTotal += Math.abs(values[i]);
  }

  const wape = actualTotal > 0 ? absoluteError / actualTotal : null;
  return {
    wape,
    accuracy: wape == null ? null : clamp((1 - wape) * 100, 0, 100),
    mae: absoluteError / days,
    days,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function emptyModel() {
  return {
    ok: false,
    daily: [],
    historyChart: [],
    forecastDays: [],
    totals: { orders: 0, bottles: 0 },
    busiestDay: null,
    history: {
      firstDate: "",
      lastDate: "",
      days: 0,
      orders: 0,
      activeDays: 0,
      bottles: 0,
      revenue: 0,
      hotels: 0,
      flavours: 0,
    },
    trend: { last30: 0, prev30: 0, changePct: null, direction: "stable" },
    backtest: null,
    flavourForecast: [],
    categoryForecast: [],
    hotelForecast: [],
    flavourHistory: [],
    categoryHistory: [],
    topHotelsHistory: [],
    summaryLines: ["No order history yet — create orders and this forecast will train automatically."],
    modelLabel: "recency-weighted weekday seasonality + trend",
  };
}

export function buildDemandForecast(rawOrders, options = {}) {
  const today = options.today || localTodayISO();
  const orders = (Array.isArray(rawOrders) ? rawOrders : [])
    .map(normalizeOrder)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!orders.length) return emptyModel();

  const { daily, firstDate, lastDate } = buildDaily(orders, today);
  const dates = daily.map((day) => day.date);
  const ordersSeries = daily.map((day) => day.orders);
  const bottlesSeries = daily.map((day) => day.bottles);

  const ordersModel = fitSeries(ordersSeries, dates, { halfLife: 45 });
  const bottlesModel = fitSeries(bottlesSeries, dates, { halfLife: 45 });

  const forecastDays = [];
  let forecastOrders = 0;
  let forecastBottles = 0;

  for (let horizon = 1; horizon <= 7; horizon += 1) {
    const date = addDaysISO(lastDate, horizon);
    const predictedBottles = round(bottlesModel.predict(horizon, date));
    let predictedOrders = round(ordersModel.predict(horizon, date));
    if (predictedBottles > 0 && predictedOrders === 0) predictedOrders = 1;

    forecastOrders += predictedOrders;
    forecastBottles += predictedBottles;

    forecastDays.push({
      date,
      weekday: weekdayLabel(date),
      orders: predictedOrders,
      bottles: predictedBottles,
      expected: predictedBottles,
    });
  }

  const busiestDay = forecastDays.reduce(
    (best, day) => (!best || day.bottles > best.bottles ? day : best),
    null
  );

  const last30 = bottlesSeries.slice(-30);
  const previous30 = bottlesSeries.slice(-60, -30);
  const last30Avg = last30.length ? sum(last30) / last30.length : 0;
  const previous30Avg = previous30.length ? sum(previous30) / previous30.length : 0;
  const changePct =
    previous30Avg > 0 ? ((last30Avg - previous30Avg) / previous30Avg) * 100 : null;
  const direction =
    changePct == null ? "stable" : changePct > 5 ? "rising" : changePct < -5 ? "falling" : "stable";

  // ---- flavour history + forecast ----------------------------------------
  const flavourTotals = new Map();
  const flavourOrderTotals = new Map();
  orders.forEach((order) => {
    const seen = new Set();
    order.items.forEach((item) => {
      const bottles = item.crates * bottlesPerCrate(item.category) + item.loose;
      if (bottles <= 0) return;
      const key = `${item.category}|${item.flavour}`;
      flavourTotals.set(key, (flavourTotals.get(key) || 0) + bottles);
      seen.add(key);
    });
    seen.forEach((key) => {
      flavourOrderTotals.set(key, (flavourOrderTotals.get(key) || 0) + 1);
    });
  });

  const flavourKeys = [...flavourTotals.keys()].sort((a, b) => {
    const totalDiff = (flavourTotals.get(b) || 0) - (flavourTotals.get(a) || 0);
    if (totalDiff !== 0) return totalDiff;
    return a.localeCompare(b);
  });

  const rawFlavourForecast = flavourKeys.map((key) => {
    const [category, ...rest] = key.split("|");
    const flavour = rest.join("|");
    const bottleSeries = daily.map((day) => day.byFlavour[key] || 0);
    const orderSeries = daily.map((day) => day.byFlavourOrders[key] || 0);
    const bottleModel = fitSeries(bottleSeries, dates, { halfLife: 45 });
    const orderModel = fitSeries(orderSeries, dates, { halfLife: 45 });

    let bottles = 0;
    let flavourOrders = 0;
    for (let horizon = 1; horizon <= 7; horizon += 1) {
      const date = addDaysISO(lastDate, horizon);
      bottles += bottleModel.predict(horizon, date);
      flavourOrders += orderModel.predict(horizon, date);
    }

    return {
      key,
      category,
      flavour,
      label: `${category} - ${flavour}`,
      bottles,
      orders: flavourOrders,
      historyBottles: flavourTotals.get(key) || 0,
      historyOrders: flavourOrderTotals.get(key) || 0,
    };
  });

  const rawFlavourTotal = sum(rawFlavourForecast.map((item) => item.bottles));
  const flavourScale = rawFlavourTotal > 0 ? forecastBottles / rawFlavourTotal : 0;
  const rawFlavourOrders = sum(rawFlavourForecast.map((item) => item.orders));
  const flavourOrderScale = rawFlavourOrders > 0 ? forecastOrders / rawFlavourOrders : 0;

  const flavourForecast = rawFlavourForecast
    .map((item) => ({
      ...item,
      bottles: round(item.bottles * flavourScale),
      orders: round(item.orders * flavourOrderScale),
      share: forecastBottles > 0 ? (item.bottles * flavourScale) / forecastBottles : 0,
    }))
    .filter((item) => item.bottles > 0 || item.orders > 0)
    .sort((a, b) => b.bottles - a.bottles || b.orders - a.orders);

  // Keep the flavour totals consistent with the overall forecast even after
  // independent rounding. The largest line absorbs the tiny remainder.
  if (flavourForecast.length) {
    const difference = forecastBottles - sum(flavourForecast.map((item) => item.bottles));
    if (difference !== 0) flavourForecast[0].bottles = Math.max(0, flavourForecast[0].bottles + difference);
  }

  // ---- category forecast -------------------------------------------------
  const categoryMap = new Map();
  flavourForecast.forEach((item) => {
    const current = categoryMap.get(item.category) || {
      category: item.category,
      bottles: 0,
      orders: 0,
    };
    current.bottles += item.bottles;
    current.orders += item.orders;
    categoryMap.set(item.category, current);
  });
  const categoryForecast = [...categoryMap.values()].sort((a, b) => {
    const orderA = CATEGORIES.indexOf(a.category);
    const orderB = CATEGORIES.indexOf(b.category);
    if (orderA >= 0 && orderB >= 0) return orderA - orderB;
    if (orderA >= 0) return -1;
    if (orderB >= 0) return 1;
    return b.bottles - a.bottles;
  });

  // ---- hotel recency-weighted shares ------------------------------------
  const lastDay = dayNumber(lastDate);
  const hotels = new Map();
  let totalOrderWeight = 0;
  let totalBottleWeight = 0;

  orders.forEach((order) => {
    const age = Math.max(0, lastDay - dayNumber(order.date));
    const weight = Math.pow(0.5, age / 60); // 60-day half-life
    const current = hotels.get(order.hotel) || {
      name: order.hotel,
      weightOrders: 0,
      weightBottles: 0,
      historyOrders: 0,
      historyBottles: 0,
      lastOrder: order.date,
    };

    current.weightOrders += weight;
    current.weightBottles += weight * order.bottles;
    current.historyOrders += 1;
    current.historyBottles += order.bottles;
    if (order.date > current.lastOrder) current.lastOrder = order.date;

    totalOrderWeight += weight;
    totalBottleWeight += weight * order.bottles;
    hotels.set(order.hotel, current);
  });

  const hotelForecast = [...hotels.values()]
    .map((hotel) => ({
      name: hotel.name,
      orders: round(forecastOrders * (totalOrderWeight ? hotel.weightOrders / totalOrderWeight : 0)),
      bottles: round(forecastBottles * (totalBottleWeight ? hotel.weightBottles / totalBottleWeight : 0)),
      shareOrders: totalOrderWeight ? hotel.weightOrders / totalOrderWeight : 0,
      shareBottles: totalBottleWeight ? hotel.weightBottles / totalBottleWeight : 0,
      historyOrders: hotel.historyOrders,
      historyBottles: hotel.historyBottles,
      lastOrder: hotel.lastOrder,
    }))
    .sort((a, b) => b.bottles - a.bottles || b.orders - a.orders);

  // Keep hotel bottle totals consistent with the overall forecast.
  if (hotelForecast.length) {
    const difference = forecastBottles - sum(hotelForecast.map((hotel) => hotel.bottles));
    if (difference !== 0) hotelForecast[0].bottles = Math.max(0, hotelForecast[0].bottles + difference);
  }

  // ---- history charts ----------------------------------------------------
  const historyChart = daily.slice(-HISTORY_CHART_DAYS).map((day) => ({
    date: day.date,
    label: monthDayLabel(day.date),
    orders: day.orders,
    bottles: day.bottles,
    revenue: day.revenue,
  }));

  const flavourHistory = flavourKeys
    .map((key) => {
      const [category, ...rest] = key.split("|");
      return {
        key,
        category,
        flavour: rest.join("|"),
        bottles: flavourTotals.get(key) || 0,
        orders: flavourOrderTotals.get(key) || 0,
      };
    })
    .sort((a, b) => b.bottles - a.bottles);

  const categoryHistoryMap = new Map();
  flavourHistory.forEach((item) => {
    categoryHistoryMap.set(
      item.category,
      (categoryHistoryMap.get(item.category) || 0) + item.bottles
    );
  });
  const categoryHistory = [...categoryHistoryMap.entries()]
    .map(([category, bottles]) => ({ category, bottles }))
    .sort((a, b) => b.bottles - a.bottles);

  const topHotelsHistory = [...hotels.values()]
    .map((hotel) => ({
      name: hotel.name,
      orders: hotel.historyOrders,
      bottles: hotel.historyBottles,
      lastOrder: hotel.lastOrder,
    }))
    .sort((a, b) => b.bottles - a.bottles);

  // ---- backtest ----------------------------------------------------------
  const orderBacktest = backtestSeries(ordersSeries, dates);
  const bottleBacktest = backtestSeries(bottlesSeries, dates);
  const backtest =
    orderBacktest && bottleBacktest
      ? {
          days: BACKTEST_DAYS,
          orderAccuracy: orderBacktest.accuracy,
          bottleAccuracy: bottleBacktest.accuracy,
          orderWape: orderBacktest.wape,
          bottleWape: bottleBacktest.wape,
        }
      : null;

  // ---- human-readable summary -------------------------------------------
  const allBottles = sum(bottlesSeries);
  const allRevenue = daily.reduce((total, day) => total + day.revenue, 0);
  const history = {
    firstDate,
    lastDate,
    days: daily.length,
    orders: orders.length,
    activeDays: daily.filter((day) => day.orders > 0).length,
    bottles: allBottles,
    revenue: allRevenue,
    hotels: hotels.size,
    flavours: flavourKeys.length,
  };

  const summaryLines = [];
  summaryLines.push(
    `Learned from ${history.orders.toLocaleString("en-IN")} order(s) across ${history.activeDays.toLocaleString(
      "en-IN"
    )} active day(s), ${firstDate} to ${lastDate}.`
  );
  summaryLines.push(
    `Next 7 days: ~${forecastOrders.toLocaleString("en-IN")} orders and ~${forecastBottles.toLocaleString(
      "en-IN"
    )} bottles.`
  );
  if (busiestDay) {
    summaryLines.push(
      `Busiest expected day: ${busiestDay.weekday}, ${busiestDay.date} — ~${busiestDay.orders} order(s), ~${busiestDay.bottles} bottles.`
    );
  }
  if (changePct != null) {
    const sign = changePct >= 0 ? "+" : "";
    summaryLines.push(
      `Demand is ${direction} (${sign}${changePct.toFixed(1)}% vs the previous 30 days).`
    );
  }
  if (flavourForecast.length) {
    summaryLines.push(
      `Top flavours: ${flavourForecast
        .slice(0, 5)
        .map((item) => `${item.flavour} ~${item.bottles}`)
        .join(", ")} bottles.`
    );
  }
  if (hotelForecast.length) {
    summaryLines.push(
      `Top hotels: ${hotelForecast
        .slice(0, 3)
        .map((hotel) => `${hotel.name} ~${hotel.orders} orders / ${hotel.bottles} bottles`)
        .join("; ")}.`
    );
  }
  if (backtest) {
    summaryLines.push(
      `Backtest on the last ${backtest.days} days: ${backtest.orderAccuracy.toFixed(
        0
      )}% order-count accuracy, ${backtest.bottleAccuracy.toFixed(0)}% bottle-volume accuracy.`
    );
  }
  summaryLines.push(
    "Forecast method: recency-weighted weekday seasonality + trend, learned from every order in the history."
  );

  return {
    ok: true,
    daily,
    historyChart,
    forecastDays,
    totals: { orders: forecastOrders, bottles: forecastBottles },
    busiestDay,
    history,
    trend: {
      last30: last30Avg,
      prev30: previous30Avg,
      changePct,
      direction,
    },
    backtest,
    flavourForecast,
    categoryForecast,
    hotelForecast,
    flavourHistory,
    categoryHistory,
    topHotelsHistory,
    summaryLines,
    modelLabel: "recency-weighted weekday seasonality + trend",
    knownFlavours: FLAVOURS,
  };
}
