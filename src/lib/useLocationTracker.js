// src/lib/useLocationTracker.js
// React hook wrapping locationService for the PWA location debug UX.
// Exposes: permission state, last coords, first fix (for map.flyTo), error,
// a visible Debug Log buffer, and enable()/check() actions.
import { useCallback, useEffect, useState } from "react";
import {
  checkLocationPermission,
  requestLocationPermission,
  startPeriodicTracking,
  stopPeriodicTracking,
  subscribeLocationEvents,
  describeGeoError,
} from "@/lib/locationService";

export function useLocationTracker({ user = null, autoStart = false } = {}) {
  const [permission, setPermission] = useState("unknown");
  const [coords, setCoords] = useState(null);
  const [firstFix, setFirstFix] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);
  const [debugLog, setDebugLog] = useState([]);

  const log = useCallback((msg, level = "info") => {
    const entry = { t: new Date().toLocaleTimeString(), level, msg };
    setDebugLog((prev) => [entry, ...prev].slice(0, 80));
    if (level === "error") console.error("[location]", msg);
    else console.log("[location]", msg);
  }, []);

  useEffect(() => {
    const unsub = subscribeLocationEvents({
      onFix: (c) => {
        setCoords(c);
        setError(null);
        setFirstFix((prev) => prev || c);
        log(`Fix: ${Number(c.latitude).toFixed(5)}, ${Number(c.longitude).toFixed(5)} (±${Math.round(c.accuracy || 0)}m)`);
      },
      onError: (err) => {
        setError(err);
        log(`${err.code}: ${err.message}`, "error");
      },
    });
    return unsub;
  }, [log]);

  const check = useCallback(async () => {
    const p = await checkLocationPermission();
    setPermission(p);
    return p;
  }, []);

  const enable = useCallback(async () => {
    log("Requesting location permission…");
    const r = await requestLocationPermission();
    if (r.ok) {
      setPermission("granted");
      setCoords(r.coords);
      setFirstFix(r.coords);
      log(`Permission granted @ ${Number(r.coords.latitude).toFixed(5)}, ${Number(r.coords.longitude).toFixed(5)}`);
      if (user) { startPeriodicTracking(user); setActive(true); }
      return true;
    }
    setPermission("denied");
    setError(r.error);
    log(describeGeoError(r.error?.raw || r.error).message, "error");
    return false;
  }, [user, log]);

  const stop = useCallback(() => { stopPeriodicTracking(); setActive(false); log("Tracking stopped."); }, [log]);

  useEffect(() => {
    if (autoStart) check();
    return () => {};
  }, [autoStart]);

  return { permission, coords, firstFix, error, active, debugLog, check, enable, stop, log };
}