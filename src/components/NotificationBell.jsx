import { db } from "@/api/db";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing } from "lucide-react";

import supabase from "@/lib/supabaseClient";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Admin notification inbox. New distributor orders are inserted into
// public.notifications by a database trigger (migration 011); a Realtime
// subscription makes the bell update instantly in every open admin session.
// When the admin has granted browser notification permission, an OS-level
// notification is shown as well.
export default function NotificationBell({ user }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      // The select policy lets admins read all rows, so explicitly filter to
      // this admin's own notifications.
      setNotifications(await db.entities.Notification.filter({ user_id: user.id }, "-created_at", 30));
    } catch {
      // Table might not exist until migration 011 is applied — stay quiet.
    }
  }, [user?.id]);

  useEffect(() => {
    load();
    if (!user?.id) return undefined;

    const channel = supabase
      .channel(`admin-notifications-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const incoming = payload.new;
          setNotifications((prev) => [incoming, ...prev].slice(0, 30));
          toast({ title: incoming.title, description: incoming.body });
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              new Notification(incoming.title, { body: incoming.body });
            } catch {
              // Some browsers only allow notifications from a service worker.
            }
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load, toast, user?.id]);

  const unread = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const enableBrowserAlerts = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") toast({ title: "Browser alerts enabled" });
  };

  const markRead = async (n) => {
    if (!n.read) {
      try { await db.entities.Notification.update(n.id, { read: true }); } catch { /* ignore */ }
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    if (n.data?.order_id) navigate("/orders");
  };

  const markAllRead = async () => {
    const unreadItems = notifications.filter((n) => !n.read);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await Promise.all(unreadItems.map((n) => db.entities.Notification.update(n.id, { read: true }).catch(() => {})));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {unread > 0 ? <BellRing className="h-5 w-5 text-primary" /> : <Bell className="h-5 w-5" />}
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>Mark all read</Button>}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications yet.</p>
          )}
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => markRead(n)}
              className={`block w-full border-b px-3 py-2 text-left text-xs hover:bg-accent ${n.read ? "" : "bg-primary/5"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{n.title}</span>
                {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </div>
              <div className="mt-0.5 text-muted-foreground">{n.body}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {n.created_at ? new Date(n.created_at).toLocaleString() : ""}
              </div>
            </button>
          ))}
        </div>
        {permission === "default" && (
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            <span className="text-[11px] text-muted-foreground">Want desktop alerts too?</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={enableBrowserAlerts}>Enable</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
