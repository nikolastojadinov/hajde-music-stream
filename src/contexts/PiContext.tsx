import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PaymentDTO, AuthResult } from '@/types/pi-sdk';

export type PiUser = {
  uid: string;
  username: string;
  roles: string[];
};


interface PiContextValue {
  user: PiUser | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  createPayment: (args: { amount: number; memo: string; metadata?: Record<string, unknown> }) => Promise<void>;
}

const PiContext = createContext<PiContextValue | undefined>(undefined);

const getBackendBaseUrl = () => {
  const url = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (!url) return '';
  return url.replace(/\/$/, '');
};

export function PiProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PiUser | null>(null);

  const backendBase = useMemo(() => getBackendBaseUrl(), []);

  // Initialize Pi SDK once
  useEffect(() => {
    try {
      const sandbox = import.meta.env.VITE_PI_SANDBOX === 'true';
      if (typeof window !== 'undefined' && window.Pi && typeof window.Pi.init === 'function') {
        window.Pi.init({ version: '2.0', sandbox });
      }
    } catch (_e) {
      // ignore if not in Pi Browser
    }
  }, []);

  const onIncompletePaymentFound = useCallback(async (_payment: PaymentDTO) => {
    // No-op: verification handled via /api/payments/verify
  }, []);

  const signIn = useCallback(async () => {
    // Request scopes needed for app
    const scopes = ['username', 'payments', 'roles', 'in_app_notifications'];
  const authResult: AuthResult = await window.Pi.authenticate(scopes, onIncompletePaymentFound);

    if (!backendBase) throw new Error('Missing VITE_BACKEND_URL');
    const res = await fetch(`${backendBase}/user/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ authResult }),
    });
    if (!res.ok) {
      throw new Error('Pi sign-in failed');
    }
    const data = await res.json();
    // optional: server could return user; fallback to auth result
    setUser((data.user as PiUser) ?? authResult.user as any);
  }, [backendBase, onIncompletePaymentFound]);

  const signOut = useCallback(async () => {
    setUser(null);
    if (!backendBase) return;
    try {
      await fetch(`${backendBase}/user/signout`, { credentials: 'include' });
    } catch (_e) {}
  }, [backendBase]);

  const createPayment = useCallback(async ({ amount, memo, metadata }: { amount: number; memo: string; metadata?: Record<string, unknown> }) => {
    if (!user) throw new Error('Not signed in');

    const onReadyForServerApproval = (_paymentId: string) => {};
    const onReadyForServerCompletion = (_paymentId: string, _txid: string) => {};
    const onCancel = (_paymentId: string) => {};

    const onError = (error: Error) => {
      console.error('Pi payment error', error);
    };

    await window.Pi.createPayment({ amount, memo, metadata: metadata ?? {} }, {
      onReadyForServerApproval,
      onReadyForServerCompletion,
      onCancel,
      onError,
    });
  }, [backendBase, user]);

  const value = useMemo(() => ({ user, signIn, signOut, createPayment }), [user, signIn, signOut, createPayment]);

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
}

export function usePi() {
  const ctx = useContext(PiContext);
  if (!ctx) throw new Error('usePi must be used within PiProvider');
  return ctx;
}
