import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePiAuth } from '@/lib/pi/usePiAuth';
import { usePiPayments } from '@/lib/pi/usePiPayments';
import { toast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';

export type PiUser = {
  uid: string;
  username: string;
  premium?: boolean;
  premium_until?: string | null;
};

interface PiContextValue {
  user: PiUser | null;
  setUser: (u: PiUser | null) => void;
  loading: boolean;
  isLoading: boolean; // backward-compatible alias
  error: string | null;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  signOut: () => Promise<void>; // backward-compatible alias
  createPayment: (args: { amount: number; memo: string; metadata?: Record<string, unknown> }) => Promise<void>;
  isProcessingPayment: boolean;
  paymentError: string | null;
}

const PiContext = createContext<PiContextValue | undefined>(undefined);

// Initialize Pi SDK IMMEDIATELY (before any hooks run)
if (typeof window !== 'undefined' && window.Pi && typeof window.Pi.init === 'function') {
  try {
    const sandbox = import.meta.env.VITE_PI_SANDBOX === 'true';
    window.Pi.init({ version: '2.0', sandbox });
    console.log('[PiContext] Pi SDK initialized early, sandbox:', sandbox);
  } catch (e) {
    console.log('[PiContext] Pi SDK early init failed:', e);
  }
}

export function PiProvider({ children }: { children: React.ReactNode }) {
  // Local, stable user state for the whole session
  const [user, setUser] = useState<PiUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Use new Pi authentication hook (we'll mirror its result into our local state)
  const { user: authUser, isLoading, error: authError, authenticate, refreshUser } = usePiAuth();
  
  // Use new Pi payments hook
  const { isProcessing: isProcessingPayment, error: paymentError, createPayment: createPiPayment } = usePiPayments();
  
  // Use language context for translations
  const { t } = useLanguage();

  // Track if we've shown welcome message to avoid showing it multiple times
  const hasShownWelcome = useRef(false);

  // Mirror usePiAuth user into local stable state and show welcome toast
  useEffect(() => {
    // Update local state from usePiAuth
    if (authUser) {
      setUser((prev) => {
        if (!prev || prev.uid !== authUser.uid) {
          console.log('[PiContext] setUser:', authUser);
        }
        return authUser;
      });
      setLoading(false);
      setError(null);
    } else if (!isLoading) {
      // No user and auth not loading: finalize loading state
      setUser(null);
      setLoading(false);
      setError(authError || null);
    }

    // Welcome toast once per session
    if (authUser && !hasShownWelcome.current) {
      hasShownWelcome.current = true;
      
      // Format welcome message with username
      const welcomeTitle = t('welcome_user').replace('{username}', authUser.username);
      const welcomeDescription = authUser.premium 
        ? t('premium_access_message')
        : t('logged_in_message');
      
      toast({
        title: welcomeTitle,
        description: welcomeDescription,
        duration: 5000,
      });
      console.log('[PiContext] Welcome toast shown for user:', authUser.username);
    }
  }, [authUser, isLoading, authError, t]);

  // Log current user on changes (diagnostics)
  useEffect(() => {
    console.log('[PiContext] current user:', user);
  }, [user]);

  const signIn = useCallback(async () => {
    console.log('[PiContext] Manual sign-in requested');
    setLoading(true);
    setError(null);
    await authenticate();
  }, [authenticate]);

  const signOut = useCallback(async () => {
    console.log('[PiContext] Sign-out requested');
    hasShownWelcome.current = false;
    setUser(null);
    // Clear to a known state; if app expects reload, keep it simple
    window.location.reload();
  }, []);

  // Alias required by spec
  const logout = signOut;

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

    // Refresh user data after successful payment to get updated premium_until
    console.log('[PiContext] Payment completed, refreshing user data...');
    await refreshUser();
    
    // Show success toast after refresh completes
    console.log('[PiContext] Showing premium activation toast');
    const welcomeTitle = t('welcome_user').replace('{username}', user.username);
    const premiumMessage = t('premium_access_message');
    
    toast({
      title: welcomeTitle,
      description: premiumMessage,
      duration: 7000,
    });
    
  }, [user, createPiPayment, refreshUser, t]);


  const value = useMemo(() => ({
    user,
    setUser,
    loading,
    isLoading: loading, // backward-compatible alias
    error,
    signIn,
    logout,
    signOut: logout,
    createPayment,
    isProcessingPayment,
    paymentError,
  }), [user, loading, error, signIn, logout, createPayment, isProcessingPayment, paymentError]);

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
}

export function usePi() {
  const ctx = useContext(PiContext);
  if (!ctx) throw new Error('usePi must be used within PiProvider');
  console.log('[usePi] state:', { user: ctx.user, loading: ctx.loading });
  return ctx;
}
