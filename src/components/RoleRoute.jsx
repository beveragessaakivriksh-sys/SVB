import { db } from "@/api/db";

import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";

// Layout-level guard: only the listed roles may reach the nested routes.
// Distributor accounts are confined to the two distributor screens; they are
// redirected there from every other URL (including direct link navigation).
export default function RoleRoute({ roles, children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    db.auth.me()
      .then((u) => { if (active) { setUser(u); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!roles.includes(user?.role)) {
    return <Navigate to={user?.role === "distributor" ? "/distributor-incoming-orders" : "/login"} replace />;
  }

  return children ?? <Outlet />;
}
