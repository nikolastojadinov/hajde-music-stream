import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePiPayments } from "@/lib/pi/usePiPayments";
import type { AuthResult } from "@/types/pi-sdk";
import { toast } from "@/hooks/use-toast";

export type AuthUser = {
  uid: string;
  username: string;
  premium: boolean;
  premium_until: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  loading: boolean;
  isLoading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  signOut: () => Promise<void>;
  createPayment: (params: { amount: number; memo: string; metadata?: Record<string, unknown> }) => Promise<void>;
  isProcessingPayment: boolean;
  paymentError: string | null;
  welcomeVisible: boolean;
  dismissWelcome: () => void;
  goPremiumVisible: boolean;
  dismissGoPremium: () => void;
  refreshUser: () => Promise<void>;
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
const PI_SCOPE = ["username", "payments"];
let piInitialized = false;
const WELCOME_DISMISS_DELAY = 3200;
const AUTH_TIMEOUT_MS = 12000;

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function postAuthResult(authResult: AuthResult): Promise<AuthUser> {
  const maxRetries = 2;
  const timeout = 45_000;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${BACKEND_URL}/pi/auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(authResult),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const details = errorData?.details || errorData?.error || response.statusText;
        throw new Error(details || "Authentication failed");
      }

      const data = await response.json();
      return {
        uid: data.user.uid,
        username: data.user.username,
        premium: Boolean(data.user.premium),
        premium_until: data.user.premium_until ?? null,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) {
        throw lastError;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw lastError || new Error("Authentication failed");
}

function normalizeUser(response: any): AuthUser {
  return {
    uid: response.uid,
    username: response.username,
    premium: Boolean(response.premium),
    premium_until: response.premium_until ?? null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [goPremiumVisible, setGoPremiumVisible] = useState(false);
  const pendingGoPremium = useRef(false);
  const welcomeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { isProcessing: isProcessingPayment, error: paymentError, createPayment: createPiPayment } = usePiPayments();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.Pi || typeof window.Pi.init !== "function") return;
    if (piInitialized) return;

    try {
      const sandbox = import.meta.env.VITE_PI_SANDBOX === "true";
      window.Pi.init({ version: "2.0", sandbox });
      piInitialized = true;
    } catch (initError) {
      console.warn("[Auth] Failed to initialize Pi SDK", initError);
    }
  }, []);

  const setUser = useCallback((next: AuthUser | null) => {
    setAuthUser(next);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!user?.uid) return;

    try {
      const response = await fetch(`${BACKEND_URL}/user/${user.uid}`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const refreshed = normalizeUser(data.user);
      setAuthUser(refreshed);

      if (refreshed.premium) {
        pendingGoPremium.current = false;
        setGoPremiumVisible(false);
      }
    } catch (err) {
      console.warn("[Auth] Failed to refresh user", err);
    }
  }, [user?.uid]);

  const clearWelcomeTimer = useCallback(() => {
    if (welcomeTimeoutRef.current) {
      clearTimeout(welcomeTimeoutRef.current);
      welcomeTimeoutRef.current = null;
    }
  }, []);

  const clearAuthTimeout = useCallback(() => {
    if (authTimeoutRef.current) {
      clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = null;
    }
  }, []);

  const dismissWelcome = useCallback(() => {
    clearWelcomeTimer();
    setWelcomeVisible(false);
    if (pendingGoPremium.current) {
      setGoPremiumVisible(true);
    }
  }, [clearWelcomeTimer]);

  const logout = useCallback(async () => {
    clearWelcomeTimer();
    clearAuthTimeout();
    setAuthUser(null);
    setError(null);
    setWelcomeVisible(false);
    setGoPremiumVisible(false);
    pendingGoPremium.current = false;

    try {
      await fetch(`${BACKEND_URL}/user/signout`, {
        method: "GET",
        credentials: "include",
      });
    } catch (err) {
      console.warn("[Auth] Failed to inform backend about logout", err);
    }
  }, [clearWelcomeTimer]);

  const login = useCallback(async () => {
    if (isAuthenticating) return;

    setIsAuthenticating(true);
    setError(null);
    clearWelcomeTimer();
    clearAuthTimeout();
    setWelcomeVisible(false);
    setGoPremiumVisible(false);
    pendingGoPremium.current = false;

    try {
      if (typeof window === "undefined" || !window.Pi) {
        throw new Error("Pi SDK not available");
      }

      const authPromise = window.Pi.authenticate(PI_SCOPE, async (payment) => {
        console.log("[Auth] Found incomplete payment", payment);
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        authTimeoutRef.current = window.setTimeout(() => {
          reject(new Error("Authentication timed out. Please try again."));
        }, AUTH_TIMEOUT_MS);
      });

      const authResult = await Promise.race([authPromise, timeoutPromise]);

      const profile = await postAuthResult(authResult);
      setAuthUser(profile);

      const premiumUntilDate = profile.premium_until ? new Date(profile.premium_until) : null;
      const premiumUntilValid = Boolean(
        premiumUntilDate &&
        !Number.isNaN(premiumUntilDate.getTime()) &&
        premiumUntilDate.getTime() > Date.now(),
      );
      const isPremiumActive = premiumUntilValid;

      pendingGoPremium.current = !isPremiumActive;
      setGoPremiumVisible(false);
      setWelcomeVisible(true);

      const username = profile.username?.trim() || "Pioneer";
      const message = isPremiumActive
        ? `Welcome, ${username} — Premium member until ${premiumUntilDate?.toLocaleDateString()}`
        : `Welcome, ${username}!`;

      toast({
        title: message,
        duration: WELCOME_DISMISS_DELAY,
      });

      welcomeTimeoutRef.current = window.setTimeout(() => {
        dismissWelcome();
      }, WELCOME_DISMISS_DELAY);
    } catch (err) {
      clearWelcomeTimer();
      clearAuthTimeout();
      setWelcomeVisible(false);
      setGoPremiumVisible(false);
      pendingGoPremium.current = false;
      const message = err instanceof Error ? err.message : "Authentication failed";
      const cancelled = message.toLowerCase().includes("cancel");
      setError(cancelled ? null : message);
      if (!cancelled) {
        console.error("[Auth] Login failed", message);
      }
      setAuthUser(null);
    } finally {
      clearAuthTimeout();
      setIsAuthenticating(false);
    }
  }, [isAuthenticating, clearWelcomeTimer, dismissWelcome]);

  const dismissGoPremium = useCallback(() => {
    setGoPremiumVisible(false);
    pendingGoPremium.current = false;
  }, []);

  const createPayment = useCallback(async ({ amount, memo, metadata }: { amount: number; memo: string; metadata?: Record<string, unknown> }) => {
    if (!user) {
      throw new Error("Not signed in");
    }

    const payment = await createPiPayment({
      amount,
      metadata: { memo, ...metadata },
    });

    if (payment) {
      await refreshUser();
    }
  }, [user, createPiPayment, refreshUser]);

  useEffect(() => {
    return () => {
      clearWelcomeTimer();
      clearAuthTimeout();
    };
  }, [clearWelcomeTimer, clearAuthTimeout]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    setUser,
    loading: isAuthenticating,
    isLoading: isAuthenticating,
    error,
    signIn: login,
    login,
    logout,
    signOut: logout,
    createPayment,
    isProcessingPayment,
    paymentError,
    welcomeVisible,
    dismissWelcome,
    goPremiumVisible,
    dismissGoPremium,
    refreshUser,
  }), [user, setUser, isAuthenticating, error, login, logout, createPayment, isProcessingPayment, paymentError, welcomeVisible, dismissWelcome, goPremiumVisible, dismissGoPremium, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
