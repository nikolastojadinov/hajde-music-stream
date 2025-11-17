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
        ['username', 'payments', 'platform'],
        async (payment) => {
          console.log('[Pi] Incomplete payment found:', payment);
          // Handle incomplete payments if needed
        }
      );

      console.log('[Pi] Authentication successful:', authResult.user.uid);

      // Send auth result to backend
      console.log('[Pi] Sending auth to backend:', `${BACKEND_URL}/pi/auth`);

      const response = await fetch(`${BACKEND_URL}/pi/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(authResult),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Backend authentication failed');
      }

      const data = await response.json();

      console.log('[Pi] Backend authentication successful:', data.user);

      setUser(data.user);
      setIsLoading(false);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
      console.error('[Pi ERROR] Authentication failed:', errorMessage);
      setError(errorMessage);
      setIsLoading(false);
    }
  }, []);

  // Auto-authenticate on mount
  useEffect(() => {
    console.log('[Pi] Auto-login: Checking Pi SDK...');

    // Wait for Pi SDK to be ready
    const checkPiSdk = () => {
      if (window.Pi) {
        console.log('[Pi] Pi SDK ready, starting auto-login...');
        authenticate();
      } else {
        console.log('[Pi] Pi SDK not ready, retrying in 100ms...');
        setTimeout(checkPiSdk, 100);
      }
    };

    checkPiSdk();
  }, [authenticate]);

  return {
    user,
    isLoading,
    error,
    authenticate,
  };
}
