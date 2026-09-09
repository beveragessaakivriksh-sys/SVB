// src/api/db.js
//
// Supabase-backed replacement for base44's injected `globalThis.__B44_DB__`
// client. Every page/component in this app was written against a small
// `db.auth.*` / `db.entities.<Entity>.*` interface — this module implements
// that exact same interface on top of `@supabase/supabase-js`, so none of the
// call sites (pages, hooks, components) needed to change.
//
// Entity -> table mapping:
//   Bill            -> bills
//   CrateEntry      -> crate_entries
//   Customer        -> customers
//   DailyProduction -> daily_productions
//   DailySummary    -> daily_summaries
//   Delivery        -> deliveries
//   InvoiceSeries   -> invoice_series
//   Order           -> orders
//   Product         -> products
//   User            -> profiles (read-only list, used to show driver/user names)

import supabase from "@/lib/supabaseClient";

const TABLES = {
  Bill: "bills",
  CrateEntry: "crate_entries",
  Customer: "customers",
  DailyProduction: "daily_productions",
  DailySummary: "daily_summaries",
  Delivery: "deliveries",
  InvoiceSeries: "invoice_series",
  Order: "orders",
  Product: "products",
  User: "profiles",
};

function applySort(query, sort) {
  if (!sort) return query;
  const desc = sort.startsWith("-");
  const column = desc ? sort.slice(1) : sort;
  return query.order(column, { ascending: !desc });
}

function makeEntity(table) {
  return {
    async list(sort, limit) {
      let q = supabase.from(table).select("*");
      q = applySort(q, sort);
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async filter(query = {}, sort, limit) {
      let q = supabase.from(table).select("*");
      for (const [key, value] of Object.entries(query || {})) {
        q = q.eq(key, value);
      }
      q = applySort(q, sort);
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async get(id) {
      const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },

    async create(payload) {
      const { data, error } = await supabase.from(table).insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async update(id, payload) {
      const { data, error } = await supabase.from(table).update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },

    async delete(id) {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
      return { id };
    },

    // Bulk delete, matching base44's `deleteMany(query)` interface — used by
    // Settings' "Clear Data" buttons with an empty query (delete every row
    // this user is permitted to delete, i.e. respecting RLS). PostgREST
    // requires at least one filter on a DELETE, so an empty query uses a
    // filter that's true for every row rather than sending no filter at all.
    async deleteMany(query = {}) {
      let q = supabase.from(table).delete();
      const entries = Object.entries(query || {});
      if (entries.length === 0) {
        q = q.not("id", "is", null);
      } else {
        for (const [key, value] of entries) q = q.eq(key, value);
      }
      const { error } = await q;
      if (error) throw error;
      return { success: true };
    },
  };
}

const entities = Object.fromEntries(
  Object.entries(TABLES).map(([entityName, table]) => [entityName, makeEntity(table)])
);

async function fetchProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

const auth = {
  // Returns the current user's profile (id, email, full_name, role) or null.
  async me() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const profile = await fetchProfile(user.id);
    return profile || { id: user.id, email: user.email, role: "user" };
  },

  async isAuthenticated() {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session;
  },

  async loginViaEmailPassword(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  // Registers a new account. The chosen account type ("user"/"admin") is
  // carried in signup metadata and applied by the `handle_new_user` trigger
  // (see supabase/migrations/001_initial_schema.sql and 004_admin_signup_no_approval.sql).
  async register({ email, password, role }) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: role ? { role } : undefined },
    });
    if (error) throw error;
    return data;
  },

  // Verifies the 6-digit email OTP code sent at signup and returns a session.
  async verifyOtp({ email, otpCode }) {
    const { data, error } = await supabase.auth.verifyOtp({ email, token: otpCode, type: "signup" });
    if (error) throw error;
    return { access_token: data?.session?.access_token, session: data?.session, user: data?.user };
  },

  async resendOtp(email) {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) throw error;
    return true;
  },

  // Sets the active session's access token. Supabase manages its own session
  // storage/refresh internally, so once verifyOtp() resolves the client is
  // already authenticated — this is a no-op kept for interface compatibility.
  setToken() {},

  async resetPasswordRequest(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
    return true;
  },

  // Supabase's recovery email link establishes a temporary session in the
  // browser automatically (detectSessionInUrl). Once that session is active,
  // setting the new password is just an updateUser call.
  async resetPassword({ newPassword }) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return true;
  },

  async logout() {
    await supabase.auth.signOut();
  },

  redirectToLogin(returnTo) {
    const encoded = encodeURIComponent(returnTo || window.location.href);
    window.location.href = `/login?returnTo=${encoded}`;
  },
};

export const db = { auth, entities };
export default db;
