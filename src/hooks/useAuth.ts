import { useState, useEffect, useCallback } from 'react';
import { loadSession, clearSession, type AuthSession } from '../services/auth';

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const s = await loadSession();
    setSession(s);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
  }, []);

  return {
    session,
    isAuthenticated: session != null,
    isReady: session !== undefined,
    refresh,
    signOut,
    setSessionLocal: (s: AuthSession) => setSession(s),
  };
}
