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

// Get backend base URL with proper validation
function getBackendBaseUrl(): string | null {
  const url = import.meta.env.VITE_BACKEND_URL;
  
  if (!url || typeof url !== 'string') {
    console.warn('VITE_BACKEND_URL not configured - Pi payments will not work');
    return null;
  }
  
  // Trim whitespace and remove trailing slash
  return url.trim().replace(/\/$/, '');
}

const backendBase = getBackendBaseUrl();

export function PiProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PiUser | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  const onIncompletePaymentFound = useCallback((payment: PaymentDTO) => {
    console.log('[Pi] Incomplete payment found:', payment);
  }, []);

  // Wait for Pi SDK to load
  const waitForPi = useCallback(() => {
    return new Promise<typeof window.Pi>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Pi SDK not loaded after 5 seconds'));
      }, 5000);

      const check = () => {
        if (window.Pi) {
          clearTimeout(timeout);
          resolve(window.Pi);
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }, []);

  // Initialize Pi SDK
  useEffect(() => {
    if (typeof window === 'undefined') return;

    (async () => {
      try {
        const Pi = await waitForPi();
        const sandbox = import.meta.env.VITE_PI_SANDBOX === 'true';
        Pi.init({ version: '2.0', sandbox });
        setSdkReady(true);
        setSdkError(null);
        console.log('[Pi] SDK ready');
      } catch (error) {
        console.error('[Pi] SDK init error:', error);
        setSdkError('Please open this app in Pi Browser to continue');
      }
    })();
  }, [waitForPi]);

  // Auto-login after SDK is ready
  useEffect(() => {
    if (!sdkReady || user !== null) return;

    const autoLogin = async () => {
      try {
        console.log('[Pi] Starting authenticate...');
        
        if (!window.Pi || typeof window.Pi.authenticate !== 'function') {
          console.error('[Pi] Pi.authenticate is not available');
          setSdkError('Pi SDK authenticate method not available');
          return;
        }

        const authResult: AuthResult = await window.Pi.authenticate(
          ['username', 'payments'],
          onIncompletePaymentFound
        );

        console.log('[Pi] Auth result:', authResult);
        console.log('[Pi] Sending to backend:', JSON.stringify({ authResult }));

        if (!authResult?.accessToken) {
          console.warn('[Pi] No access token in authResult');
          setSdkError('No access token received from Pi');
          return;
        }

        if (!backendBase) {
          console.warn('[Pi] Backend URL not configured - skipping authentication');
          setSdkError('Backend not configured');
          return;
        }

        const res = await fetch(`${backendBase}/user/signin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ authResult }),
        });

        console.log('[Pi] Fetch completed, status:', res.status);

        if (!res.ok) {
          let errorText = '';
          try {
            errorText = await res.text();
            console.error('[Pi] Backend error:', res.status, errorText);
          } catch (e) {
            console.error('[Pi] Could not read error body:', e);
          }
          setSdkError(`Backend error: ${res.status}`);
          return;
        }

        const data = await res.json();
        console.log('[Pi] Backend response:', JSON.stringify(data, null, 2));
        
        if (data?.user) {
          setUser(data.user);
          setShowWelcomeModal(true);
          setTimeout(() => setShowWelcomeModal(false), 3000);
          console.log('[Pi] Login successful!');
        } else {
          console.warn('[Pi] No user in backend response');
          setSdkError('No user data received from backend');
        }
      } catch (error: any) {
        console.error('[Pi] Auto-login error:', {
          message: error?.message,
          stack: error?.stack,
          error: error
        });
        setSdkError(error?.message || 'Authentication failed');
      }
    };

    console.log('[Pi Debug] Starting auto-login, backendBase:', backendBase);
    autoLogin();
  }, [sdkReady, user, onIncompletePaymentFound]);

  const signOut = useCallback(async () => {
    setUser(null);
    if (!backendBase) {
      console.warn('[Pi] Backend URL not configured - skipping signout request');
      return;
    }
    try {
      await fetch(`${backendBase}/user/signout`, { credentials: 'include' });
    } catch (error) {
      console.error('[Pi] Signout error:', error);
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

    if (!sdkReady || !window.Pi?.createPayment) {
      throw new Error('Pi SDK not available. Please open this app in Pi Browser.');
    }

    const onReadyForServerApproval = async (paymentId: string) => {
      console.log('[Pi] Payment ready for approval:', paymentId);
      
      if (!backendBase) {
        console.warn('[Pi] Backend URL not configured - skipping approval');
        return;
      }
      
      try {
        const response = await fetch(`${backendBase}/payments/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paymentId }),
        });
        
        const result = await response.json();
        console.log('[Pi] Approval response:', result);
        
        if (!result.success) {
          console.error('[Pi] Approval failed:', result.error);
        }
      } catch (error) {
        console.error('[Pi] Approval request failed:', error);
      }
    };

    const onReadyForServerCompletion = async (paymentId: string, txid: string) => {
      console.log('[Pi] Payment ready for completion:', paymentId, txid);
      
      if (!backendBase) {
        console.warn('[Pi] Backend URL not configured - skipping completion');
        return;
      }
      
      try {
        const response = await fetch(`${backendBase}/payments/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paymentId, txid }),
        });
        
        const result = await response.json();
        console.log('[Pi] Completion response:', result);
        
        if (!result.success) {
          console.error('[Pi] Completion failed:', result.error);
        }
      } catch (error) {
        console.error('[Pi] Completion request failed:', error);
      }
    };

    const onCancel = async (paymentId: string) => {
      console.log('[Pi] Payment cancelled:', paymentId);
      
      if (!backendBase) {
        console.warn('[Pi] Backend URL not configured - skipping cancel');
        return;
      }
      
      try {
        await fetch(`${backendBase}/payments/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paymentId }),
        });
      } catch (error) {
        console.error('[Pi] Cancel request failed:', error);
      }
    };

    const onError = (error: Error, payment?: PaymentDTO) => {
      console.error('[Pi] Payment error:', error);
      throw error;
    };

    const payment = await window.Pi.createPayment(
      { 
        amount, 
        memo, 
        metadata: {
          ...metadata,
          user_uid: user.uid, // Always include user UID for backend
        }
      },
      {
        onReadyForServerApproval,
        onReadyForServerCompletion,
        onCancel,
        onError,
      }
    );

    return payment;
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
