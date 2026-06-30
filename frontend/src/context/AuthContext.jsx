"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";

const AuthContext = createContext(undefined);

// Routes that require authentication
const PROTECTED_ROUTES = [
  "/input",
  "/srs",
  "/team-design",
  "/cost-estimation",
  "/download",
  "/history",
];

// Routes that logged in users shouldn't see
const AUTH_ROUTES = ["/login", "/register"];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api/v1";
const TOKEN_KEY = "scopesense_token";
const USER_KEY = "scopesense_user";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const fetchPlan = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/user/plan`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (response.ok) {
        const planData = await response.json();
        setPlan(planData);
      }
    } catch (error) {
      console.warn("Failed to fetch user plan:", error);
    }
  }, []);

  const persistSession = useCallback((nextUser, token) => {
    if (!token || !nextUser) {
      return;
    }
    const hydratedUser = { ...nextUser, token };
    setUser(hydratedUser);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setPlan(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  const fetchUserMe = useCallback(async (token) => {
    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (response.ok) {
        const userData = await response.json();
        persistSession(userData, token);
      } else {
        clearSession();
      }
    } catch (error) {
      console.warn("Failed to fetch user:", error);
      const cachedUser = localStorage.getItem(USER_KEY);
      if (cachedUser) {
        try {
          setUser({ ...JSON.parse(cachedUser), token });
        } catch {
          clearSession();
        }
      } else {
        clearSession();
      }
    } finally {
      setLoading(false);
    }
  }, [clearSession, persistSession]);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      clearSession();
      return null;
    }

    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          clearSession();
          return null;
        }
        throw new Error(`Server returned status ${response.status}`);
      }
      const userData = await response.json();
      persistSession(userData, token);
      return { ...userData, token };
    } catch (error) {
      console.warn("Failed to refresh user:", error);
      const cachedUser = localStorage.getItem(USER_KEY);
      if (!cachedUser) {
        clearSession();
        return null;
      }
      try {
        const parsed = JSON.parse(cachedUser);
        const nextUser = { ...parsed, token };
        setUser(nextUser);
        return nextUser;
      } catch {
        clearSession();
        return null;
      }
    }
  }, [clearSession, persistSession]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const cachedUser = localStorage.getItem(USER_KEY);

    if (!token) {
      setLoading(false);
      return;
    }

    if (cachedUser) {
      try {
        setUser({ ...JSON.parse(cachedUser), token });
        setLoading(false);
        refreshUser();
        return;
      } catch {
        localStorage.removeItem(USER_KEY);
      }
    }

    fetchUserMe(token);
  }, [fetchUserMe, refreshUser]);

  useEffect(() => {
    if (user) {
      fetchPlan();
    } else {
      setPlan(null);
    }
  }, [user, fetchPlan]);

  // Handle route protection
  useEffect(() => {
    if (!loading) {
      const isProtectedRoute = PROTECTED_ROUTES.some(route => pathname?.startsWith(route));
      const isAuthRoute = AUTH_ROUTES.some(route => pathname?.startsWith(route));

      if (isProtectedRoute && !user) {
        // Redirect to home landing page if trying to access protected route without being logged in
        router.push("/");
      } else if (isAuthRoute && user) {
        // Redirect to home if trying to access login/register while already logged in
        router.push("/");
      }
    }
  }, [user, loading, pathname, router]);

  const login = async (email, password) => {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      
      const data = await response.json();
      if (response.ok) {
        persistSession(data.user, data.access_token);
        refreshUser();
        router.push("/input");
        return { success: true };
      }
      return { success: false, error: data.detail || "Invalid email or password" };
    } catch (err) {
      return { success: false, error: "Network error" };
    }
  };

  const register = async (name, email, password) => {
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
      });
      
      const data = await response.json();
      if (response.ok) {
        persistSession(data.user, data.access_token);
        refreshUser();
        router.push("/input");
        return { success: true };
      }
      return { success: false, error: data.detail || "Registration failed" };
    } catch (err) {
      return { success: false, error: "Network error" };
    }
  };

  const logout = () => {
    clearSession();
    router.push("/");
  };

  const forgotPassword = async (email) => {
    try {
      const response = await fetch(`${API_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (response.ok) {
        return { success: true, message: data.message };
      }
      return { success: false, error: data.detail || "Unable to request password reset" };
    } catch (err) {
      return { success: false, error: "Network error" };
    }
  };

  const resetPassword = async (email, otp, newPassword) => {
    try {
      const response = await fetch(`${API_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, new_password: newPassword })
      });
      const data = await response.json();
      if (response.ok) {
        return { success: true, message: data.message };
      }
      return { success: false, error: data.detail || "Password reset failed" };
    } catch (err) {
      return { success: false, error: "Network error" };
    }
  };

  return (
    <AuthContext.Provider value={{ user, plan, refreshPlan: fetchPlan, loading, login, register, logout, refreshUser, forgotPassword, resetPassword }}>
      {/* Show nothing while initial auth check is happening on protected routes */}
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
