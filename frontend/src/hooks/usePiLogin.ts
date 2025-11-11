import { useCallback, useState } from 'react';

type AuthResult = {
  accessToken: string;
  user: {
    uid: string;
    username: string;
    roles: string[];
  };
};

declare global {
  interface Window {
    Pi: any;
  }
}

export function usePiLogin() {
  const [user, setUser] = useState<AuthResult['user'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scopes = ['username', 'payments', 'roles', 'in_app_notifications'];
      const authResult: AuthResult = await window.Pi.authenticate(scopes, () => {});

      const backendUrl = (import.meta as any).env.VITE_BACKEND_URL as string | undefined;
      if (!backendUrl) throw new Error('Missing VITE_BACKEND_URL');

      // call backend to verify and create session
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/user/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ authResult }),
      });
      if (!res.ok) throw new Error('Signin failed');
      const data = await res.json();
      setUser(data.user ?? authResult.user);
    } catch (e: any) {
      setError(e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  return { login, loading, error, user };
}
