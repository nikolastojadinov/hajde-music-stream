import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
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
  isLoading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
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
  // Use new Pi authentication hook (auto-login on mount)
  const { user, isLoading, error, authenticate, refreshUser } = usePiAuth();
  
  // Use new Pi payments hook
  const { isProcessing: isProcessingPayment, error: paymentError, createPayment: createPiPayment } = usePiPayments();
  
  // Use language context for translations
  const { t } = useLanguage();

  // Track if we've shown welcome message to avoid showing it multiple times
  const hasShownWelcome = useRef(false);

  // Show welcome toast when user logs in
  useEffect(() => {
    if (user && !hasShownWelcome.current) {
      hasShownWelcome.current = true;
      
      // Format welcome message with username
      const welcomeTitle = t('welcome_user').replace('{username}', user.username);
      const welcomeDescription = user.premium 
        ? t('premium_access_message')
        : t('logged_in_message');
      
      toast({
        title: welcomeTitle,
        description: welcomeDescription,
        duration: 5000,
      });
      
      console.log('[PiContext] Welcome toast shown for user:', user.username);
    }
  }, [user, t]);

  const signIn = useCallback(async () => {
    console.log('[PiContext] Manual sign-in requested');
    await authenticate();
  }, [authenticate]);

  const signOut = useCallback(async () => {
    console.log('[PiContext] Sign-out requested');
    // Reset welcome flag
    hasShownWelcome.current = false;
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
