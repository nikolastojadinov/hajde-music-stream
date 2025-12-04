import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type PiUser = {
  uid: string;
  username: string | null;
  premium: boolean;
  premium_until: string | null;
};

type PiContextValue = {
  user: PiUser | null;
  loading: boolean;
  isPiBrowser: boolean;
  setUserFromPi: (next: PiUser | null) => void;
  clearPiUser: () => void;
};

let piUserStore: PiUser | null = null;
const listeners = new Set<(next: PiUser | null) => void>();

const PiContext = createContext<PiContextValue>({
  user: null,
  loading: true,
  isPiBrowser: false,
  setUserFromPi: () => undefined,
  clearPiUser: () => undefined,
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

export const PiProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<PiUser | null>(piUserStore);
  const [loading, setLoading] = useState(true);
  const [isPiBrowser, setIsPiBrowser] = useState(() => detectPiBrowser());

  useEffect(() => {
    setIsPiBrowser(detectPiBrowser());

    if (!piUserStore) {
      const hydratedUser = readPiUserFromWindow();
      if (hydratedUser) {
        setUserFromPi(hydratedUser);
      }
    } else {
      setUser(piUserStore);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    const listener = (next: PiUser | null) => {
      setUser(next);
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const value = useMemo<PiContextValue>(
    () => ({
      user,
      loading,
      isPiBrowser,
      setUserFromPi,
      clearPiUser,
    }),
    [user, loading, isPiBrowser],
  );

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
};

export const usePi = () => useContext(PiContext);
