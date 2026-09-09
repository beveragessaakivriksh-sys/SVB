// src/lib/locationService.js
// Periodic 15-minute breadcrumb logging + on-demand high-frequency live tracking,
// backed by Supabase (live_locations / location_history) with an IndexedDB offline queue.
//
// PWA-standalone hardened:
//  - Low-power geolocation lock first (enableHighAccuracy:false), 15s timeout, 10s cache.
//  - Explicit error mapping for all 3 GeolocationPositionError codes.
//  - Visible event emitter (subscribeLocationEvents) so UI can render a Debug Log + banners.
//  - Supabase writes guarded by an auth.uid() check + try/catch + console.error logging.
//  - 15-minute setInterval fallback that calls getCurrentPosition() and writes location_history.
import supabase from "@/lib/supabaseClient";

const DB_NAME = "svb_locations";
const STORE = "queue";
const PERIODIC_MS = 15 * 60 * 1000;

// Geolocation options: low-power lock first (instant), then live mode upgrades to high accuracy.
const GEO_OPTS_LOW = { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 };
const GEO_OPTS_HIGH = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

let periodicTimer = null;
let liveWatchId = null;
let liveSub = null;
let currentUser = null;
let isLive = false;

// ---------- Event emitter (debug log + errors + fixes) ----------
const listeners = new Set();
function emit(type, payload) { listeners.forEach((fn) => { try { fn({ type, payload }); } catch {} }); }
export function subscribeLocationEvents({ onFix, onError } = {}) {
  const fn = (e) => {
    if (e.type === "fix" && onFix) onFix(e.payload);
    if (e.type === "error" && onError) onError(e.payload);
  };
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Map a GeolocationPositionError to a readable message + code label.
export function describeGeoError(err) {
  const code = err?.code;
  const map = {
    1: { code: "PERMISSION_DENIED", message: "Location permission denied. Enable it in your browser or site settings, then tap Enable Location Access again." },
    2: { code: "POSITION_UNAVAILABLE", message: "Position unavailable (GPS/network). Move outdoors or check your connection, then retry." },
    3: { code: "TIMEOUT", message: "Location request timed out. The 15-minute fallback will retry automatically." },
  };
  return map[code] || { code: "UNKNOWN", message: err?.message || "Unknown location error." };
}

// ---------- IndexedDB offline queue ----------
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function enqueue(rec) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add(rec);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch {}
}
async function drainQueue() {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      const os = tx.objectStore(STORE);
      const req = os.getAll();
      req.onsuccess = () => { os.clear(); res(req.result || []); };
      req.onerror = () => rej(req.error);
    });
  } catch { return []; }
}

// ---------- geolocation ----------
function getPosition(opts = GEO_OPTS_LOW) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) { rej({ code: 0, message: "Geolocation not supported on this device." }); return; }
    navigator.geolocation.getCurrentPosition((p) => res(p.coords), (e) => rej(e), opts);
  });
}

// ---------- Supabase writes (auth-guarded) ----------
async function getAuthUid() {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id || currentUser?.id || null;
  } catch { return currentUser?.id || null; }
}

async function pushHistory(lat, lon, accuracy) {
  const uid = await getAuthUid();
  if (!uid) { console.error("[location] Supabase write skipped — no auth.uid()"); return; }
  const rec = { user_id: uid, latitude: lat, longitude: lon, accuracy: accuracy || 0, created_at: new Date().toISOString() };
  try {
    const { error } = await supabase.from("location_history").insert(rec);
    if (error) { console.error("Supabase Write Error (location_history):", error); await enqueue(rec); }
  } catch (e) { console.error("Supabase Write Error (location_history):", e); await enqueue(rec); }
}
async function upsertLive(lat, lon, speed, heading) {
  const uid = await getAuthUid();
  if (!uid) { console.error("[location] Supabase write skipped — no auth.uid()"); return; }
  const rec = { user_id: uid, latitude: lat, longitude: lon, speed: speed || 0, heading: heading || 0, is_live_active: true, updated_at: new Date().toISOString() };
  try {
    const { error } = await supabase.from("live_locations").upsert(rec);
    if (error) console.error("Supabase Write Error (live_locations):", error);
  } catch (e) { console.error("Supabase Write Error (live_locations):", e); }
}
async function ensureLiveRow() {
  const uid = await getAuthUid();
  if (!uid) return;
  try {
    const { error } = await supabase.from("live_locations").upsert({ user_id: uid, latitude: 0, longitude: 0, is_live_active: false, updated_at: new Date().toISOString() });
    if (error) console.error("Supabase Write Error (live_locations init):", error);
  } catch (e) { console.error("Supabase Write Error (live_locations init):", e); }
}
async function setLiveActive(active) {
  const uid = await getAuthUid();
  if (!uid) return;
  try {
    const { error } = await supabase.from("live_locations").update({ is_live_active: active, updated_at: new Date().toISOString() }).eq("user_id", uid);
    if (error) console.error("Supabase Write Error (live_locations active):", error);
  } catch (e) { console.error("Supabase Write Error (live_locations active):", e); }
}

async function syncQueue() {
  if (!navigator.onLine) return;
  try {
    const items = await drainQueue();
    if (!items.length) return;
    const { error } = await supabase.from("location_history").insert(items);
    if (error) { console.error("Supabase Write Error (drain queue):", error); items.forEach(enqueue); }
  } catch (e) { console.error("Supabase Write Error (drain queue):", e); }
}

// ---------- Periodic 15-minute tracker (with explicit fallback) ----------
export async function startPeriodicTracking(user) {
  if (!user || periodicTimer) return;
  currentUser = user;
  await ensureLiveRow();
  // Immediate low-power lock.
  try {
    const c = await getPosition(GEO_OPTS_LOW);
    emit("fix", c);
    console.log(`[location] fix: ${c.latitude}, ${c.longitude} (±${c.accuracy || 0}m)`);
    await pushHistory(c.latitude, c.longitude, c.accuracy);
  } catch (e) {
    const desc = describeGeoError(e);
    emit("error", { ...desc, raw: e });
    console.error("[location] initial lock failed:", desc.message);
  }
  syncQueue();
  // Explicit 15-minute fallback: getCurrentPosition() → location_history (backup to watchPosition).
  periodicTimer = setInterval(async () => {
    try {
      const c = await getPosition(GEO_OPTS_LOW);
      emit("fix", c);
      console.log(`[location] 15-min fallback fix: ${c.latitude}, ${c.longitude}`);
      await pushHistory(c.latitude, c.longitude, c.accuracy);
    } catch (e) {
      const desc = describeGeoError(e);
      emit("error", { ...desc, raw: e });
      console.error("[location] 15-min fallback failed:", desc.message);
    }
    syncQueue();
  }, PERIODIC_MS);
  window.addEventListener("online", syncQueue);
  // Watch admin-triggered high-frequency mode for this user
  liveSub = supabase
    .channel(`live_${user.id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_locations", filter: `user_id=eq.${user.id}` }, async (payload) => {
      if (payload.new?.is_live_active && !isLive) await startLiveTracking();
      else if (!payload.new?.is_live_active && isLive) await stopLiveTracking();
    })
    .subscribe();
}

export function stopPeriodicTracking() {
  if (periodicTimer) { clearInterval(periodicTimer); periodicTimer = null; }
  window.removeEventListener("online", syncQueue);
  if (liveSub) { try { supabase.removeChannel(liveSub); } catch {} liveSub = null; }
  stopLiveTracking();
}

// ---------- On-demand live tracking ----------
export async function startLiveTracking() {
  if (liveWatchId != null) return;
  isLive = true;
  await setLiveActive(true);
  liveWatchId = navigator.geolocation.watchPosition(
    async (p) => {
      emit("fix", p.coords);
      console.log(`[location] live fix: ${p.coords.latitude}, ${p.coords.longitude}`);
      await upsertLive(p.coords.latitude, p.coords.longitude, p.coords.speed, p.coords.heading);
    },
    (e) => {
      const desc = describeGeoError(e);
      emit("error", { ...desc, raw: e });
      console.error("[location] watchPosition error:", desc.message);
    },
    GEO_OPTS_HIGH
  );
}
export async function stopLiveTracking() {
  if (liveWatchId != null) { navigator.geolocation.clearWatch(liveWatchId); liveWatchId = null; }
  isLive = false;
  await setLiveActive(false);
}
export const isLiveTrackingActive = () => isLive;

// ---------- Admin helpers ----------
export function subscribeLive(cb) {
  const ch = supabase
    .channel("live_locations_all")
    .on("postgres_changes", { event: "*", schema: "public", table: "live_locations" }, (payload) => cb(payload.new))
    .subscribe();
  return () => { try { supabase.removeChannel(ch); } catch {} };
}
export async function fetchLive() {
  try { const { data } = await supabase.from("live_locations").select("*"); return data || []; } catch { return []; }
}
export async function fetchHistory(userId, from, to) {
  try {
    let q = supabase.from("location_history").select("*").eq("user_id", userId).order("created_at", { ascending: true });
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    const { data } = await q;
    return data || [];
  } catch { return []; }
}
export async function requestHighFrequency(userId, on) {
  try { return await supabase.from("live_locations").update({ is_live_active: on, updated_at: new Date().toISOString() }).eq("user_id", userId); } catch {}
}

export async function checkLocationPermission() {
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const r = await navigator.permissions.query({ name: "geolocation" });
      return r.state;
    }
  } catch {}
  return "unknown";
}

export async function requestLocationPermission() {
  try {
    const c = await getPosition(GEO_OPTS_LOW);
    emit("fix", c);
    return { ok: true, coords: c };
  } catch (e) {
    const desc = describeGeoError(e);
    emit("error", { ...desc, raw: e });
    return { ok: false, error: { ...desc, raw: e } };
  }
}