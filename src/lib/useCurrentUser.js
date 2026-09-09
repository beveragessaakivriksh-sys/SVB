import { db } from "@/api/db";

import { useEffect, useState } from "react";

export function useCurrentUser() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    db.auth.me().then(setUser).catch(() => {});
  }, []);
  return user;
}