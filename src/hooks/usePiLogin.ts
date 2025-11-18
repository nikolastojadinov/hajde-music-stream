// Thin compatibility wrapper that proxies to the global PiContext
// This keeps existing components working while centralizing auth state.
import { usePi } from '@/contexts/PiContext';

export function usePiLogin() {
  const { user, isLoading, error, signIn } = usePi();

  return {
    login: signIn,
    loading: isLoading,
    error,
    user: user ? { uid: user.uid, username: user.username, roles: [] as string[] } : null,
  };
}
