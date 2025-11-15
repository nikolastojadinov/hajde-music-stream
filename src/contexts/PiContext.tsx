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
  createPayment: (args: { amount: number; memo: string; metadata?: Record<string, unknown> }) => Promise<PaymentDTO>;
  sdkReady: boolean;
  sdkError: string | null;
  showWelcomeModal: boolean;
  setShowWelcomeModal: (show: boolean) => void;
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
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  const backendBase = useMemo(() => getBackendBaseUrl(), []);

  // Auto-login when SDK is ready
  const autoLogin = useCallback(async () => {
    if (!window.Pi || typeof window.Pi.authenticate !== 'function') {
      return;
    }

    console.log('[Pi Auto-Login] Starting automatic authentication...');

    try {
      const scopes = ['username', 'payments'];
      const onIncompletePaymentFound = (payment: PaymentDTO) => {
        console.log('[Pi Auto-Login] Incomplete payment found:', payment);
      };

      const authResult: AuthResult = await window.Pi.authenticate(scopes, onIncompletePaymentFound);

      console.log('[Pi Auto-Login] Authentication result:', {
        uid: authResult.user.uid,
        username: authResult.user.username,
        hasAccessToken: !!authResult.accessToken
      });

      if (!authResult.accessToken) {
        console.error('[Pi Auto-Login] No accessToken received from Pi SDK');
        throw new Error('No accessToken received from Pi SDK');
      }

      if (!backendBase) throw new Error('Backend URL not configured');

      console.log('[Pi Auto-Login] Sending auth result to backend...');
      const res = await fetch(`${backendBase}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ authResult }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[Pi Auto-Login] Backend sign-in failed:', res.status, errorText);
        throw new Error(`Sign-in failed: ${res.status}`);
      }

      const data = await res.json();
      console.log('[Pi Auto-Login] Backend sign-in successful:', data);

      const userData = data.user ?? authResult.user;
      setUser(userData);
      setShowWelcomeModal(true);

      // Auto-hide welcome modal after 3 seconds
      setTimeout(() => setShowWelcomeModal(false), 3000);
    } catch (error) {
      console.error('[Pi Auto-Login] Sign-in error:', error);
    }
  }, [backendBase]);

  // Wait for Pi SDK script to load and initialize, then auto-login
  useEffect(() => {
    const initializePiSDK = () => {
      try {
        if (typeof window !== 'undefined' && window.Pi && typeof window.Pi.init === 'function') {
          const sandbox = import.meta.env.VITE_PI_SANDBOX === 'true';
          console.log('[Pi SDK] Initializing with version 2.0, sandbox:', sandbox);
          window.Pi.init({ version: '2.0', sandbox });
          setSdkReady(true);
          setSdkError(null);
          console.log('[Pi SDK] Initialization successful');
          
          // Delay auto-login to ensure SDK is fully ready
          setTimeout(() => {
            console.log('[Pi SDK] Starting auto-login after SDK initialization...');
            autoLogin();
          }, 500);
        } else {
          console.warn('[Pi SDK] window.Pi not available');
          setSdkError('Please open this app in Pi Browser to continue');
        }
      } catch (e) {
        console.error('[Pi SDK] Initialization error:', e);
        setSdkError('Please open this app in Pi Browser to continue');
      }
    };

    if (window.Pi) {
      console.log('[Pi SDK] Script already loaded, initializing...');
      initializePiSDK();
    } else {
      console.log('[Pi SDK] Waiting for script to load...');
      const checkSDKInterval = setInterval(() => {
        if (window.Pi) {
          console.log('[Pi SDK] Script loaded, initializing...');
          clearInterval(checkSDKInterval);
          initializePiSDK();
        }
      }, 100);

      const timeout = setTimeout(() => {
        clearInterval(checkSDKInterval);
        if (!window.Pi) {
          console.error('[Pi SDK] Failed to load after 5 seconds');
          setSdkError('Please open this app in Pi Browser to continue');
        }
      }, 5000);

      return () => {
        clearInterval(checkSDKInterval);
        clearTimeout(timeout);
      };
    }
  }, [autoLogin]);

  const onIncompletePaymentFound = useCallback(async (_payment: PaymentDTO) => {
    // No-op: verification handled via /api/payments/verify
  }, []);

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

  const value = useMemo(() => ({ 
    user, 
    signOut, 
    createPayment, 
    sdkReady, 
    sdkError, 
    showWelcomeModal, 
    setShowWelcomeModal 
  }), [user, signOut, createPayment, sdkReady, sdkError, showWelcomeModal]);

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
}

export function usePi() {
  const ctx = useContext(PiContext);
  if (!ctx) throw new Error('usePi must be used within PiProvider');
  return ctx;
}
