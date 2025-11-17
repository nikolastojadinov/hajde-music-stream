/**
 * Pi Network Authentication Hook
 * Handles automatic login with Pi Browser
 */

import { useState, useEffect, useCallback } from 'react';
import type { AuthResult } from '@/types/pi-sdk';

interface PiUser {
  uid: string;
  username: string;
  premium: boolean;
  premium_until: string | null;
}

interface UsePiAuthReturn {
  user: PiUser | null;
  isLoading: boolean;
  error: string | null;
  authenticate: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export function usePiAuth(): UsePiAuthReturn {
  const [user, setUser] = useState<PiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authenticate = useCallback(async () => {
    console.log('[Pi] Starting authentication...');
    setIsLoading(true);
    setError(null);

    try {
      // Check if Pi SDK is available
      if (typeof window === 'undefined' || !window.Pi) {
        throw new Error('Pi SDK not available');
      }

      console.log('[Pi] Calling Pi.authenticate()...');

      // Authenticate with Pi Browser
      const authResult: AuthResult = await window.Pi.authenticate(
        ['username', 'payments'],
        async (payment) => {
          console.log('[Pi] Incomplete payment found:', payment);
          // Handle incomplete payments if needed
        }
      );

      console.log('[Pi] Authentication successful:', authResult.user.uid);

      // Send auth result to backend with timeout and retry
      console.log('[Pi] Sending auth to backend:', `${BACKEND_URL}/pi/auth`);

      let data: any = null;
      let lastError: Error | null = null;
      const maxRetries = 2;
      const timeout = 45000; // 45 seconds (Render može biti spor na cold start)

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`[Pi] Retry attempt ${attempt}/${maxRetries}...`);
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          const response = await fetch(`${BACKEND_URL}/pi/auth`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(authResult),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorData = await response.json();
            console.error('[Pi] Backend error response:', errorData);
            const errorMsg = errorData.details 
              ? `${errorData.error}: ${errorData.details}` 
              : errorData.error || 'Backend authentication failed';
            throw new Error(errorMsg);
          }

          data = await response.json();
          console.log('[Pi] Backend authentication successful:', data.user);
          break; // Success, exit retry loop

        } catch (err: any) {
          lastError = err;
          
          if (err.name === 'AbortError') {
            console.warn(`[Pi] Request timeout (${timeout}ms) - attempt ${attempt + 1}/${maxRetries + 1}`);
          } else {
            console.error(`[Pi] Backend error on attempt ${attempt + 1}:`, err.message);
          }

          // Don't retry on last attempt
          if (attempt === maxRetries) {
            throw err;
          }

          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }

      if (!data) {
        throw lastError || new Error('Failed to authenticate with backend');
      }

      setUser(data.user);
      setIsLoading(false);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
      console.error('[Pi ERROR] Authentication failed:', errorMessage);
      
      // If user cancelled consent, don't show as error - just stay logged out
      if (errorMessage.includes('cancelled') || errorMessage.includes('canceled')) {
        console.log('[Pi] User cancelled authentication - app can be used without login');
        setError(null); // Don't show error for user cancellation
      } else {
        setError(errorMessage);
      }
      
      setIsLoading(false);
    }
  }, []);

  // Auto-authenticate on mount
  useEffect(() => {
    console.log('[Pi] Auto-login: Checking Pi SDK...');

    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max

    // Wait for Pi SDK to be ready AND initialized
    const checkPiSdk = () => {
      attempts++;
      
      if (attempts > maxAttempts) {
        console.log('[Pi] Pi SDK not available after 5 seconds - app will work without login');
        setIsLoading(false);
        return;
      }

      if (window.Pi) {
        // SDK exists, but we need to wait a bit for init() to complete
        // PiContext calls init() around the same time
        if (attempts < 3) {
          // Give init() time to execute (300ms)
          console.log('[Pi] Pi SDK found, waiting for init()...', attempts);
          setTimeout(checkPiSdk, 100);
          return;
        }

        console.log('[Pi] Pi SDK ready, starting auto-login...');
        authenticate();
      } else {
        console.log('[Pi] Pi SDK not ready, retrying in 100ms...', attempts);
        setTimeout(checkPiSdk, 100);
      }
    };

    checkPiSdk();
  }, [authenticate]);

  // Add refreshUser function to re-fetch user data from backend
  const refreshUser = useCallback(async () => {
    console.log('[Pi] Refreshing user data...');
    
    try {
      if (!user?.uid) {
        console.log('[Pi] No user to refresh');
        return;
      }

      // Re-authenticate to get fresh user data
      await authenticate();
      
    } catch (err) {
      console.error('[Pi] Failed to refresh user:', err);
    }
  }, [user?.uid, authenticate]);

  return {
    user,
    isLoading,
    error,
    authenticate,
    refreshUser,
  };
}
