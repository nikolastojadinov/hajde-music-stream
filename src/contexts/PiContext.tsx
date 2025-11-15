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
  createPayment: (args: { amount: number; memo: string; metadata?: Record<string, unknown> }) => Promise<PaymentDTO>;
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
          // Always use production mode (sandbox: false) unless explicitly set to true
          const sandbox = import.meta.env.VITE_PI_SANDBOX === 'true';
          console.log('[Pi SDK] Initializing with version 2.0, sandbox:', sandbox);
          window.Pi.init({ version: '2.0', sandbox });
          setSdkReady(true);
          setSdkError(null);
          console.log('[Pi SDK] Initialization successful');
        } else {
          console.warn('[Pi SDK] window.Pi not available');
          setSdkError('Please open this app in Pi Browser to sign in with Pi.');
        }
      } catch (e) {
        console.error('[Pi SDK] Initialization error:', e);
        setSdkError('Failed to initialize Pi SDK. Please make sure you are in Pi Browser.');
      }
    };

    // Check if SDK is already loaded
    if (window.Pi) {
      console.log('[Pi SDK] Script already loaded, initializing...');
      initializePiSDK();
    } else {
      console.log('[Pi SDK] Waiting for script to load...');
      // Wait for SDK script to load
      const checkSDKInterval = setInterval(() => {
        if (window.Pi) {
          console.log('[Pi SDK] Script loaded, initializing...');
          clearInterval(checkSDKInterval);
          initializePiSDK();
        }
      }, 100);

      // Timeout after 5 seconds
      const timeout = setTimeout(() => {
        clearInterval(checkSDKInterval);
        if (!window.Pi) {
          console.error('[Pi SDK] Failed to load after 5 seconds');
          setSdkError('Please open this app in Pi Browser to sign in with Pi.');
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
      throw new Error('Please open this app in Pi Browser to sign in with Pi.');
    }
    
    console.log('[Pi Auth] Starting authentication...');
    
    try {
      // Request scopes needed for app - username and payments
      const scopes = ['username', 'payments'];
      const authResult: AuthResult = await window.Pi.authenticate(scopes, onIncompletePaymentFound);
      
      console.log('[Pi Auth] Authentication successful:', {
        uid: authResult.user.uid,
        username: authResult.user.username
      });

      if (!backendBase) throw new Error('Backend URL not configured');
      
      console.log('[Pi Auth] Sending auth result to backend...');
      const res = await fetch(`${backendBase}/user/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ authResult }),
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error('[Pi Auth] Backend sign-in failed:', res.status, errorText);
        throw new Error(`Sign-in failed: ${res.status}`);
      }
      
      const data = await res.json();
      console.log('[Pi Auth] Backend sign-in successful:', data);
      
      // Use the user data from backend or fallback to auth result
      setUser(data.user ?? authResult.user);
    } catch (error) {
      console.error('[Pi Auth] Sign-in error:', error);
      throw error;
    }
  }, [backendBase, onIncompletePaymentFound, sdkReady]);

  const signOut = useCallback(async () => {
    setUser(null);
    if (!backendBase) return;
    try {
      await fetch(`${backendBase}/user/signout`, { credentials: 'include' });
    } catch (_e) {}
  }, [backendBase]);

  const createPayment = useCallback(async ({ amount, memo, metadata }: { amount: number; memo: string; metadata?: Record<string, unknown> }) => {
    if (!user) throw new Error('Please sign in first');
    if (!sdkReady || !window.Pi || typeof window.Pi.createPayment !== 'function') {
      throw new Error('Please open this app in Pi Browser to make payments.');
    }

    console.log('[Pi Payment] Creating payment:', { amount, memo });

    const onReadyForServerApproval = (_paymentId: string) => {
      console.log('[Pi Payment] Ready for server approval:', _paymentId);
    };
    
    const onReadyForServerCompletion = (_paymentId: string, _txid: string) => {
      console.log('[Pi Payment] Ready for completion:', _paymentId, _txid);
    };
    
    const onCancel = (_paymentId: string) => {
      console.log('[Pi Payment] Cancelled:', _paymentId);
    };

    const onError = (error: Error) => {
      console.error('[Pi Payment] Error:', error);
    };

    const payment = await window.Pi.createPayment({ amount, memo, metadata: metadata ?? {} }, {
      onReadyForServerApproval,
      onReadyForServerCompletion,
      onCancel,
      onError,
    });
    
    console.log('[Pi Payment] Payment created:', payment);
    return payment;
  }, [user, sdkReady]);

  const value = useMemo(() => ({ user, signIn, signOut, createPayment, sdkReady, sdkError }), [user, signIn, signOut, createPayment, sdkReady, sdkError]);

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
}

export function usePi() {
  const ctx = useContext(PiContext);
  if (!ctx) throw new Error('usePi must be used within PiProvider');
  return ctx;
}
