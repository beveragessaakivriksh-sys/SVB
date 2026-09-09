import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';

import supabase from '@/lib/supabaseClient';
import { db } from '@/api/db';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  const checkUserAuth = useCallback(async () => {
    try {
      setIsLoadingAuth(true);
      const currentUser = await db.auth.me();
      setUser(currentUser);
      setIsAuthenticated(!!currentUser);
    } catch (error) {
      console.error('User auth check failed:', error);
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    checkUserAuth();

    // Keep the app in sync with Supabase's own session lifecycle (token
    // refresh, sign-in in another tab, sign-out, magic-link/recovery
    // redirects, etc.) rather than only checking once on mount.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        checkUserAuth();
      } else {
        setUser(null);
        setIsAuthenticated(false);
        setAuthChecked(true);
        setIsLoadingAuth(false);
      }
    });

    return () => subscription?.subscription?.unsubscribe();
  }, [checkUserAuth]);

  const logout = async () => {
    setUser(null);
    setIsAuthenticated(false);
    await db.auth.logout();
  };

  const navigateToLogin = () => {
    db.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      // Kept for compatibility with components still reading these — a
      // Supabase-authenticated user always has a matching `profiles` row
      // (auto-created by the `handle_new_user` trigger), so there is no
      // separate "app public settings" or "user not registered" state to
      // model here the way base44's app-registration API had.
      isLoadingPublicSettings: false,
      authError: null,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
