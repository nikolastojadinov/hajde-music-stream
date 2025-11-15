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
  sdkReady: boolean;
  sdkError: string | null;
}

const PiContext = createContext<PiContextValue | undefined>(undefined);

const getBackendBaseUrl = () => {
  const url = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (!url) return '';
  return url.replace(/\/$/, '');
};

export function PiProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PiUser | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);

  const backendBase = useMemo(() => getBackendBaseUrl(), []);

  // Wait for Pi SDK script to load and initialize
  useEffect(() => {
    const initializePiSDK = () => {
      try {
        if (typeof window !== 'undefined' && window.Pi && typeof window.Pi.init === 'function') {
          const sandbox = import.meta.env.VITE_PI_SANDBOX === 'true';
          console.log('Initializing Pi SDK with sandbox:', sandbox);
          window.Pi.init({ version: '2.0', sandbox });
          setSdkReady(true);
          setSdkError(null);
        } else {
          console.warn('Pi SDK not available');
          setSdkError('Pi SDK is not available. Please open this app in Pi Browser.');
        }
      } catch (e) {
        console.error('Error initializing Pi SDK:', e);
        setSdkError('Failed to initialize Pi SDK');
      }
    };

    // Check if SDK is already loaded
    if (window.Pi) {
      initializePiSDK();
    } else {
      // Wait for SDK script to load
      const checkSDKInterval = setInterval(() => {
        if (window.Pi) {
          clearInterval(checkSDKInterval);
          initializePiSDK();
        }
      }, 100);

      // Timeout after 5 seconds
      const timeout = setTimeout(() => {
        clearInterval(checkSDKInterval);
        if (!window.Pi) {
          console.error('Pi SDK failed to load after 5 seconds');
          setSdkError('Pi SDK failed to load. Please open this app in Pi Browser.');
        }
      }, 5000);

      return () => {
        clearInterval(checkSDKInterval);
        clearTimeout(timeout);
      };
    }
  }, []);

  const onIncompletePaymentFound = useCallback(async (_payment: PaymentDTO) => {
    // No-op: verification handled via /api/payments/verify
  }, []);

  const signIn = useCallback(async () => {
    if (!sdkReady || !window.Pi || typeof window.Pi.authenticate !== 'function') {
      throw new Error('Pi SDK not available. Please open this app in Pi Browser.');
    }
    
    console.log('Starting Pi authentication...');
    
    // Request scopes needed for app
    const scopes = ['username', 'payments', 'roles', 'in_app_notifications'];
    const authResult: AuthResult = await window.Pi.authenticate(scopes, onIncompletePaymentFound);
    
    console.log('Authentication successful:', authResult.user);

    if (!backendBase) throw new Error('Missing VITE_BACKEND_URL');
    
    console.log('Sending auth result to backend...');
    const res = await fetch(`${backendBase}/user/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ authResult }),
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Backend sign-in failed:', errorText);
      throw new Error('Pi sign-in failed on backend');
    }
    
    const data = await res.json();
    console.log('Backend sign-in successful:', data);
    
    // optional: server could return user; fallback to auth result
    setUser((data.user as PiUser) ?? authResult.user as any);
  }, [backendBase, onIncompletePaymentFound, sdkReady]);

  const signOut = useCallback(async () => {
    setUser(null);
    if (!backendBase) return;
    try {
      await fetch(`${backendBase}/user/signout`, { credentials: 'include' });
    } catch (_e) {}
  }, [backendBase]);

  const createPayment = useCallback(async ({ amount, memo, metadata }: { amount: number; memo: string; metadata?: Record<string, unknown> }) => {
    if (!user) throw new Error('Not signed in');
    if (!window.Pi || typeof window.Pi.createPayment !== 'function') {
      throw new Error('Pi SDK not available. Please open this app in Pi Browser.');
    }

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
  }, [user]);

  const value = useMemo(() => ({ user, signIn, signOut, createPayment, sdkReady, sdkError }), [user, signIn, signOut, createPayment, sdkReady, sdkError]);

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
}

export function usePi() {
  const ctx = useContext(PiContext);
  if (!ctx) throw new Error('usePi must be used within PiProvider');
  return ctx;
}
