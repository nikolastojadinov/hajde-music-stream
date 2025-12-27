import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthProvider as PiAuthProvider, useAuth } from "@/hooks/useAuth";

export type PiUser = {
  uid: string;
  username: string | null;
  premium: boolean;
  premium_until: string | null;
};

type PiContextValue = {
  user: PiUser | null;
  loading: boolean;
  authenticating: boolean;
  isPiBrowser: boolean;
  authLog: string[];
  authError: string | null;
  setUserFromPi: (next: PiUser | null) => void;
  clearPiUser: () => void;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  signIn: () => Promise<void>;
  createPayment: (params: { amount: number; memo: string; metadata?: Record<string, unknown> }) => Promise<void>;
  isProcessingPayment: boolean;
};

let piUserStore: PiUser | null = null;
const listeners = new Set<(next: PiUser | null) => void>();

const PiContext = createContext<PiContextValue>({
  user: null,
  loading: true,
  authenticating: false,
  isPiBrowser: false,
  authLog: [],
  authError: null,
  setUserFromPi: () => undefined,
  clearPiUser: () => undefined,
  login: async () => undefined,
  logout: async () => undefined,
  signIn: async () => undefined,
  createPayment: async () => undefined,
  isProcessingPayment: false,
});

const normalizePiUser = (next: PiUser): PiUser => ({
  uid: next.uid,
  username: next.username ?? null,
  premium: Boolean(next.premium),
  premium_until: next.premium_until ?? null,
});

const detectPiBrowser = () => {
  if (typeof navigator === "undefined" || typeof navigator.userAgent !== "string") {
    return false;
  }
  const isPiBrowser = /PiBrowser/i.test(navigator.userAgent);
  return isPiBrowser;
};

const readPiUserFromWindow = (): PiUser | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const rawUser = (window as any).__PI_USER__;
  if (!rawUser || typeof rawUser !== "object") {
    return null;
  }

  if (!rawUser.uid) {
    return null;
  }

  return normalizePiUser({
    uid: rawUser.uid,
    username: rawUser.username ?? null,
    premium: Boolean(rawUser.premium),
    premium_until: rawUser.premium_until ?? null,
  });
};

const notifySubscribers = () => {
  listeners.forEach((listener) => {
    listener(piUserStore);
  });
};

export const setUserFromPi = (next: PiUser | null) => {
  piUserStore = next ? normalizePiUser(next) : null;
  notifySubscribers();
};

export const clearPiUser = () => {
  piUserStore = null;
  notifySubscribers();
};

export const getBackendHeaders = (): Record<string, string> => {
  return {
    "x-pi-user-id": piUserStore?.uid ?? "",
    "x-pi-username": piUserStore?.username ?? "",
    "x-pi-premium": piUserStore?.premium ? "true" : "false",
    "x-pi-premium-until": piUserStore?.premium_until ?? "",
  };
};

const PiStateProvider = ({ children }: { children: ReactNode }) => {
  const auth = useAuth();
  const [user, setUser] = useState<PiUser | null>(piUserStore);
  const [hydrating, setHydrating] = useState(true);
  const [isPiBrowser, setIsPiBrowser] = useState(() => detectPiBrowser());

  useEffect(() => {
    const listener = (next: PiUser | null) => {
      setUser(next);
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    setIsPiBrowser(detectPiBrowser());

    if (!piUserStore) {
      const hydratedUser = readPiUserFromWindow();
      if (hydratedUser) {
        console.info("[PiContext] Hydrated user from window", hydratedUser);
        setUserFromPi(hydratedUser);
      } else {
        clearPiUser();
      }
    }

    setHydrating(false);
  }, []);

  useEffect(() => {
    if (auth.user) {
      console.info("[PiContext] Auth user available", auth.user.uid);
      setUserFromPi({
        uid: auth.user.uid,
        username: auth.user.username ?? null,
        premium: Boolean(auth.user.premium),
        premium_until: auth.user.premium_until ?? null,
      });
      return;
    }

    if (!hydrating) {
      clearPiUser();
      console.info("[PiContext] Auth user missing after hydrate; cleared Pi user");
    }
  }, [auth.user, hydrating]);

  const value = useMemo<PiContextValue>(
    () => ({
      user,
      loading: hydrating,
      authenticating: auth.loading,
      isPiBrowser,
      authLog: auth.debugLog ?? [],
      authError: auth.lastError ?? null,
      setUserFromPi,
      clearPiUser,
      login: auth.login,
      logout: auth.logout,
      signIn: auth.signIn ?? auth.login,
      createPayment: auth.createPayment,
      isProcessingPayment: auth.isProcessingPayment,
    }),
    [
      user,
      hydrating,
      auth.loading,
      auth.debugLog,
      isPiBrowser,
      auth.login,
      auth.logout,
      auth.signIn,
      auth.createPayment,
      auth.isProcessingPayment,
    ],
  );

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
};

export const PiProvider = ({ children }: { children: ReactNode }) => {
  return (
    <PiAuthProvider>
      <PiStateProvider>{children}</PiStateProvider>
    </PiAuthProvider>
  );
};

export const usePi = () => useContext(PiContext);
