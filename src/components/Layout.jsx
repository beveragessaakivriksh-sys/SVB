import { db } from "@/api/db";

import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { FileText, Package, LayoutDashboard, Factory, BarChart3, Users, Settings, LogOut, CalendarClock, ClipboardList, Inbox, Radio, MapPin, AlertTriangle, X } from "lucide-react";
import { startPeriodicTracking, stopPeriodicTracking, checkLocationPermission, requestLocationPermission } from "@/lib/locationService";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const ALL_TABS = [
  { to: "/daily-summary", label: "Daily Summary", icon: CalendarClock, roles: ["admin", "user"] },
  { to: "/bill-entries", label: "Bill Entries", icon: FileText, roles: ["admin", "user"] },
  { to: "/crates-entries", label: "Crates", icon: Package, roles: ["admin", "user"] },
  { to: "/orders", label: "Orders", icon: ClipboardList, roles: ["admin", "user"] },
  { to: "/new-delivery", label: "Incoming Orders", icon: Inbox, roles: ["admin", "user"] },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin"] },
  { to: "/daily-production", label: "Production", icon: Factory, roles: ["admin"] },
  { to: "/data-analytics", label: "Analysis", icon: BarChart3, roles: ["admin"] },
  { to: "/customers", label: "Customers", icon: Users, roles: ["admin"] },
  { to: "/location-tracking", label: "Tracking", icon: Radio, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin"] },
];

export default function Layout() {
  const [user, setUser] = useState(null);
  const [locPerm, setLocPerm] = useState("unknown");
  const [locBannerDismissed, setLocBannerDismissed] = useState(false);
  const [showLocError, setShowLocError] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let active = true;
    db.auth.me().then(async (u) => {
      if (!active || !u) { setUser(u); return; }
      setUser(u);
      const perm = await checkLocationPermission();
      if (!active) return;
      setLocPerm(perm);
      if (perm === "granted") startPeriodicTracking(u);
    }).catch(() => {});
    return () => { active = false; stopPeriodicTracking(); };
  }, []);

  const enableLocation = async () => {
    if (!user) return;
    const r = await requestLocationPermission();
    if (r.ok) { setLocPerm("granted"); startPeriodicTracking(user); }
    else { setLocPerm("denied"); setShowLocError(true); }
  };

  const role = user?.role || "user";
  const tabs = ALL_TABS.filter((t) => t.roles.includes(role));

  const handleLogout = async () => {
    await db.auth.logout();
    navigate("/login");
  };

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-border">
        <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">SV</div>
        <div className="leading-tight">
          <div className="font-semibold text-sm">SVB</div>
          <div className="text-[11px] text-muted-foreground">Saaki Vriksh Beverages</div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <div className="px-2 pb-2 text-[11px] text-muted-foreground truncate">
          {user?.email} · <span className="capitalize">{role}</span>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" /> Logout
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      <aside className="hidden md:flex w-64 shrink-0 border-r border-border bg-sidebar">
        <SidebarContent />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top header */}
        <header className="md:hidden flex items-center justify-between gap-2 border-b border-border bg-background px-4 pb-3 pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs">SV</div>
            <span className="font-semibold text-sm">SVB</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors select-none"
          >
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </header>

        {user && locPerm !== "granted" && !locBannerDismissed && (
          <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="flex-1">Enable location access to log your route breadcrumbs and allow live tracking.</span>
            <Button size="sm" onClick={enableLocation} className="h-7 px-3 text-xs">Enable Location Access</Button>
            <button onClick={() => setLocBannerDismissed(true)} className="rounded p-1 hover:bg-amber-100"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="min-h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile bottom tab bar — all applicable tabs equally spaced */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
          <div className="flex">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) =>
                    `flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[9px] transition-colors select-none ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`
                  }
                >
                  <Icon className="h-[18px] w-[18px]" />
                  <span className="w-full truncate text-center">{t.label}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      </div>

      <Dialog open={showLocError} onOpenChange={setShowLocError}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Location access denied</DialogTitle>
            <DialogDescription>
              We couldn't access your device location. Enable location permission in your browser or site settings to start route tracking, then tap "Enable Location Access" again.
            </DialogDescription>
          </DialogHeader>
          <Button onClick={() => setShowLocError(false)}>Got it</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}