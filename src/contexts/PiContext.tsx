import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { usePiAuth } from '@/lib/pi/usePiAuth';
import { usePiPayments } from '@/lib/pi/usePiPayments';

export type PiUser = {
  uid: string;
  username: string;
  premium?: boolean;
  premium_until?: string | null;
};

interface PiContextValue {
  user: PiUser | null;
  isLoading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  createPayment: (args: { amount: number; memo: string; metadata?: Record<string, unknown> }) => Promise<void>;
  isProcessingPayment: boolean;
  paymentError: string | null;
}

const PiContext = createContext<PiContextValue | undefined>(undefined);

export function PiProvider({ children }: { children: React.ReactNode }) {
  // Use new Pi authentication hook (auto-login on mount)
  const { user, isLoading, error, authenticate } = usePiAuth();
  
  // Use new Pi payments hook
  const { isProcessing: isProcessingPayment, error: paymentError, createPayment: createPiPayment } = usePiPayments();

  // Initialize Pi SDK once
  useEffect(() => {
    console.log('[PiContext] Initializing Pi SDK...');
    try {
      const sandbox = import.meta.env.VITE_PI_SANDBOX === 'true';
      if (typeof window !== 'undefined' && window.Pi && typeof window.Pi.init === 'function') {
        window.Pi.init({ version: '2.0', sandbox });
        console.log('[PiContext] Pi SDK initialized, sandbox:', sandbox);
      }
    } catch (e) {
      console.log('[PiContext] Pi SDK init failed (not in Pi Browser):', e);
    }
  }, []);

  const signIn = useCallback(async () => {
    console.log('[PiContext] Manual sign-in requested');
    await authenticate();
  }, [authenticate]);

  const signOut = useCallback(async () => {
    console.log('[PiContext] Sign-out requested');
    // For now, just reload the page to clear state
    window.location.reload();
  }, []);

  const createPayment = useCallback(async ({ amount, memo, metadata }: { amount: number; memo: string; metadata?: Record<string, unknown> }) => {
    console.log('[PiContext] Creating payment:', { amount, memo, metadata });
    
    if (!user) {
      throw new Error('Not signed in');
    }

    await createPiPayment({
      amount,
      metadata: {
        ...metadata,
        memo,
      }
    });
  }, [user, createPiPayment]);

  const value = useMemo(() => ({
    user,
    isLoading,
    error,
    signIn,
    signOut,
    createPayment,
    isProcessingPayment,
    paymentError,
  }), [user, isLoading, error, signIn, signOut, createPayment, isProcessingPayment, paymentError]);

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
}

export function usePi() {
  const ctx = useContext(PiContext);
  if (!ctx) throw new Error('usePi must be used within PiProvider');
  return ctx;
}
