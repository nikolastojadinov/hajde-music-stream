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

  // 1. Initialize Pi SDK - wait for it to load
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initSDK = () => {
      if (!window.Pi) {
        console.log('[Pi] SDK not available, waiting...');
        return false;
      }

      try {
        const sandbox = import.meta.env.VITE_PI_SANDBOX === 'true';
        console.log('[Pi] Initializing SDK v2.0, sandbox:', sandbox);
        window.Pi.init({ version: '2.0', sandbox });
        setSdkReady(true);
        setSdkError(null);
        console.log('[Pi] SDK initialized successfully');
        return true;
      } catch (error) {
        console.error('[Pi] SDK init error:', error);
        setSdkError('Failed to initialize Pi SDK');
        return false;
      }
    };

    // Try immediate init
    if (initSDK()) return;

    // If not ready, poll for SDK
    const checkInterval = setInterval(() => {
      if (initSDK()) {
        clearInterval(checkInterval);
      }
    }, 100);

    // Give up after 10 seconds
    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      if (!window.Pi) {
        console.error('[Pi] SDK not loaded after 10s');
        setSdkError('Please open this app in Pi Browser to continue');
      }
    }, 10000);

    return () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
    };
  }, []);

  // 2. Auto-login after SDK ready
  useEffect(() => {
    if (!sdkReady || user !== null) return;

    console.log('[Pi] SDK ready, starting auto-login...');

    const autoLogin = async () => {
      try {
        console.log('[Pi] Calling authenticate...');
        const authResult: AuthResult = await window.Pi.authenticate(
          ['username', 'payments'],
          { onIncompletePaymentFound }
        );

        console.log('[Pi] Authenticate result:', { 
          hasAccessToken: !!authResult?.accessToken,
          username: authResult?.user?.username 
        });

        if (!authResult?.accessToken) {
          console.warn('[Pi] No accessToken received');
          return;
        }

        console.log('[Pi] Sending to backend:', `${backendBase}/signin`);
        const res = await fetch(`${backendBase}/signin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ authResult }),
        });

        console.log('[Pi] Backend response:', res.status);
        if (!res.ok) {
          const errorText = await res.text();
          console.error('[Pi] Backend error:', errorText);
          return;
        }

        const data = await res.json();
        console.log('[Pi] Backend data:', data);
        
        if (data?.user) {
          setUser(data.user);
          setShowWelcomeModal(true);
          setTimeout(() => setShowWelcomeModal(false), 3000);
          console.log('[Pi] Login successful!');
        }
      } catch (error) {
        console.error('[Pi] Auto-login error:', error);
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
