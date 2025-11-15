import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PaymentDTO, AuthResult } from '@/types/pi-sdk';

export type PiUser = {
  uid: string;
  username: string;
  roles: string[];
};

interface PiContextValue {
  user: PiUser | null;
  signOut: () => Promise<void>;
  createPayment: (args: { amount: number; memo: string; metadata?: Record<string, unknown> }) => Promise<void>;
  sdkReady: boolean;
  sdkError: string | null;
  showWelcomeModal: boolean;
  setShowWelcomeModal: (show: boolean) => void;
}

const PiContext = createContext<PiContextValue | undefined>(undefined);

const backendBase = import.meta.env.VITE_BACKEND_URL.replace(/\/$/, '');

export function PiProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PiUser | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  const onIncompletePaymentFound = useCallback((payment: PaymentDTO) => {
    // Handle incomplete payments - backend verifies via /payments/verify
    return payment;
  }, []);

  // 1. Initialize Pi SDK
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!window.Pi) {
      setSdkError('Please open this app in Pi Browser to continue');
      return;
    }

    try {
      const sandbox = import.meta.env.VITE_PI_SANDBOX === 'true';
      window.Pi.init({ version: '2.0', sandbox });
      setSdkReady(true);
    } catch (error) {
      setSdkError('Failed to initialize Pi SDK');
    }
  }, []);

  // 2. Auto-login after SDK ready
  useEffect(() => {
    if (!sdkReady || user !== null) return;

    const autoLogin = async () => {
      try {
        const authResult: AuthResult = await window.Pi.authenticate(
          ['username', 'payments'],
          { onIncompletePaymentFound }
        );

        if (!authResult?.accessToken) {
          return;
        }

        const res = await fetch(`${backendBase}/signin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ authResult }),
        });

        if (!res.ok) return;

        const data = await res.json();
        if (data?.user) {
          setUser(data.user);
          setShowWelcomeModal(true);
          setTimeout(() => setShowWelcomeModal(false), 3000);
        }
      } catch (error) {
        // Silently fail auto-login
      }
    };

    autoLogin();
  }, [sdkReady, user, onIncompletePaymentFound]);

  const signOut = useCallback(async () => {
    setUser(null);
    try {
      await fetch(`${backendBase}/signout`, { credentials: 'include' });
    } catch (error) {
      // Ignore signout errors
    }
  }, []);

  const createPayment = useCallback(async ({ 
    amount, 
    memo, 
    metadata 
  }: { 
    amount: number; 
    memo: string; 
    metadata?: Record<string, unknown> 
  }) => {
    if (!user) {
      throw new Error('Not signed in');
    }

    if (!sdkReady) {
      throw new Error('Pi SDK not ready');
    }

    if (!window.Pi?.createPayment) {
      throw new Error('Pi SDK not available. Please open this app in Pi Browser.');
    }

    const onReadyForServerApproval = (paymentId: string) => {
      // Backend approves payment
    };

    const onReadyForServerCompletion = (paymentId: string, txid: string) => {
      // Backend completes payment
    };

    const onCancel = (paymentId: string) => {
      // Payment cancelled
    };

    const onError = (error: Error, payment?: PaymentDTO) => {
      throw error;
    };

    await window.Pi.createPayment(
      { amount, memo, metadata: metadata ?? {} },
      {
        onReadyForServerApproval,
        onReadyForServerCompletion,
        onCancel,
        onError,
      }
    );
  }, [user, sdkReady]);

  const value = useMemo(
    () => ({
      user,
      signOut,
      createPayment,
      sdkReady,
      sdkError,
      showWelcomeModal,
      setShowWelcomeModal,
    }),
    [user, signOut, createPayment, sdkReady, sdkError, showWelcomeModal]
  );

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
}

export function usePi() {
  const ctx = useContext(PiContext);
  if (!ctx) throw new Error('usePi must be used within PiProvider');
  return ctx;
}
