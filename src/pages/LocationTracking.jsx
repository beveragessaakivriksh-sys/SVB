import { db } from "@/api/db";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import PageShell from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Radio, MapPin, Activity, LocateFixed } from "lucide-react";
import { subscribeLive, fetchLive, fetchHistory, requestHighFrequency } from "@/lib/locationService";

// Auto-centers the parent map on the first valid live position.
function AutoCenter({ live }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    const target = live.find((l) => Number(l.latitude)) || live[0];
    if (target && Number(target.latitude)) { map.flyTo([target.latitude, target.longitude], 14); done.current = true; }
  }, [live, map]);
  return null;
}

const CENTER = [12.9716, 77.5946];

export default function LocationTracking() {
  const [users, setUsers] = useState([]);
  const [live, setLive] = useState([]);
  const [tab, setTab] = useState("live");
  const [selUser, setSelUser] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [trail, setTrail] = useState([]);

  useEffect(() => { db.entities.User.list().then(setUsers).catch(() => {}); }, []);
  useEffect(() => {
    fetchLive().then(setLive);
    let unsub = () => {};
    try {
      unsub = subscribeLive((row) => {
        if (!row) return;
        setLive((prev) => {
          const i = prev.findIndex((p) => p.user_id === row.user_id);
          if (i >= 0) { const n = [...prev]; n[i] = row; return n; }
          return [...prev, row];
        });
      });
    } catch (e) { /* supabase realtime unavailable */ }
    return unsub;
  }, []);

  const loadTrail = async () => {
    if (!selUser) return;
    const f = from ? new Date(from).toISOString() : null;
    const t = to ? new Date(to + ":59").toISOString() : null;
    setTrail(await fetchHistory(selUser, f, t));
  };
  const userLabel = (u) => u?.full_name || u?.email || String(u?.id || "").slice(0, 8);
  const userName = (id) => { const u = users.find((x) => x.id === id); return userLabel(u); };
  const liveMapRef = useRef(null);
  const recenterLive = () => {
    const m = liveMapRef.current;
    if (!m) return;
    const target = live.find((l) => l.is_live_active) || live[0];
    if (target && Number(target.latitude)) m.setView([target.latitude, target.longitude], 13);
    else m.setView(CENTER, 11);
  };

  return (
    <PageShell title="Location Tracking" subtitle="Live fleet positions & historical trail map">
      <div className="mb-3 flex gap-2">
        <Button variant={tab === "live" ? "default" : "outline"} onClick={() => setTab("live")}><Radio className="h-4 w-4 mr-2" /> Live Tracking</Button>
        <Button variant={tab === "trail" ? "default" : "outline"} onClick={() => setTab("trail")}><MapPin className="h-4 w-4 mr-2" /> Historical Trail</Button>
      </div>

      {tab === "live" ? (
        <div className="rounded-xl border border-primary/20 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Active: {live.filter((l) => l.is_live_active).length} / {live.length}</div>
            <Button size="sm" variant="outline" onClick={recenterLive}><LocateFixed className="h-3.5 w-3.5 mr-1" /> Relocate Me</Button>
          </div>
          <div className="relative z-0 isolate h-[60vh] w-full overflow-hidden rounded-lg border">
            <MapContainer ref={liveMapRef} center={CENTER} zoom={11} style={{ height: "100%", width: "100%" }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
              <AutoCenter live={live} />
              {live.map((l) => (
                <CircleMarker key={l.user_id} center={[l.latitude, l.longitude]} radius={l.is_live_active ? 10 : 7} pathOptions={{ color: l.is_live_active ? "#10b981" : "#94a3b8", fillOpacity: 0.7 }}>
                  <Popup>
                    <div className="text-xs">
                      <div className="font-semibold">{userName(l.user_id)}</div>
                      <div>{Number(l.latitude).toFixed(4)}, {Number(l.longitude).toFixed(4)}</div>
                      <div>{l.is_live_active ? "Live" : "Idle"}</div>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="p-2 text-left">User</th><th className="p-2">Lat</th><th className="p-2">Lng</th><th className="p-2">Mode</th><th className="p-2">Action</th></tr></thead>
            <tbody>
              {live.map((l) => (
                <tr key={l.user_id} className="border-t">
                  <td className="p-2">{userName(l.user_id)}</td>
                  <td className="p-2 text-center">{Number(l.latitude).toFixed(4)}</td>
                  <td className="p-2 text-center">{Number(l.longitude).toFixed(4)}</td>
                  <td className="p-2 text-center">{l.is_live_active ? "Live" : "Idle"}</td>
                  <td className="p-2 text-center"><Button size="sm" variant="outline" onClick={() => requestHighFrequency(l.user_id, !l.is_live_active)}><Activity className="h-3.5 w-3.5 mr-1" />{l.is_live_active ? "Stop live" : "High-freq live"}</Button></td>
                </tr>
              ))}
              {live.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No live positions yet</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-primary/20 p-3">
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <div>
              <Label>User</Label>
              <Select value={selUser} onValueChange={setSelUser}>
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{userLabel(u)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>From</Label><Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label>To</Label><Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div className="flex items-end"><Button onClick={loadTrail} className="w-full">Load Trail</Button></div>
          </div>
          <div className="relative z-0 isolate h-[55vh] w-full overflow-hidden rounded-lg border">
            <MapContainer center={CENTER} zoom={11} style={{ height: "100%", width: "100%" }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
              {trail.length > 0 && <Polyline positions={trail.map((t) => [t.latitude, t.longitude])} pathOptions={{ color: "#10b981" }} />}
              {trail.map((t, i) => (
                <CircleMarker key={t.id || i} center={[t.latitude, t.longitude]} radius={5} pathOptions={{ color: "#10b981", fillOpacity: 0.8 }}>
                  <Popup>
                    <div className="text-xs">
                      <div>{new Date(t.created_at).toLocaleString()}</div>
                      <div>{Number(t.latitude).toFixed(4)}, {Number(t.longitude).toFixed(4)}</div>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">{trail.length} breadcrumb(s) · 15-minute nodes</div>
        </div>
      )}
    </PageShell>
  );
}