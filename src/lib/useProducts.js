import { db } from "@/api/db";

import { useEffect, useMemo, useState } from "react";

import { CATEGORIES, FLAVOURS } from "./constants";

// Returns the active products managed in Settings, with sensible fallbacks to
// the built-in category/flavour catalogue when nothing has been configured yet.
// Used across the app so product changes in Settings are reflected everywhere.
export function useProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    db.entities.Product.list()
      .then((p) => alive && setProducts(p || []))
      .catch(() => alive && setProducts([]))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const active = useMemo(
    () => (products || []).filter((p) => p.is_active).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [products]
  );

  const useFallback = active.length === 0;

  const categories = useMemo(
    () => (useFallback ? [...CATEGORIES] : Array.from(new Set(active.map((p) => p.category)))),
    [active, useFallback]
  );

  const flavoursByCategory = (cat) => {
    const fs = active.filter((p) => p.category === cat).map((p) => p.flavour);
    return fs.length ? fs : [...FLAVOURS];
  };

  // Flat list of { category, flavour, label } for building item matrices.
  // Memoized so pages can sync their item state on `productList` without
  // triggering an effect loop on every render.
  const productList = useMemo(
    () =>
      useFallback
        ? CATEGORIES.flatMap((cat) => FLAVOURS.map((fl) => ({ category: cat, flavour: fl, label: `${cat} - ${fl}` })))
        : active.map((p) => ({ category: p.category, flavour: p.flavour, label: `${p.category} - ${p.flavour}` })),
    [active, useFallback]
  );

  return { products, categories, flavoursByCategory, productList, loading };
}