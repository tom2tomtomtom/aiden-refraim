import { createContext, useContext, useEffect, useState } from 'react';

/**
 * refrAIm auth client.
 *
 * Source of truth: the Gateway-issued `aiden-gw` JWT cookie, scoped to
 * `.aiden.services`. The cookie is HttpOnly so we cannot read it from JS
 * — instead, we call the server's `/api/me` on mount, which verifies the
 * cookie and returns the decoded user claims.
 *
 * Logged-out users are bounced to the Gateway login page. refrAIm does
 * not have its own sign-in / sign-up form anymore.
 */

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const GATEWAY_URL =
  (import.meta.env.VITE_GATEWAY_URL as string | undefined) || 'https://www.aiden.services';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) || '/api';

function gatewayLoginUrl(): string {
  const next = encodeURIComponent(window.location.href);
  return `${GATEWAY_URL}/login?next=${next}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/me`, { credentials: 'include' });
        if (cancelled) return;

        if (res.ok) {
          const body = (await res.json()) as AuthUser;
          setUser({ id: body.id, email: body.email });
        } else {
          setUser(null);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = () => {
    // Gateway owns logout. It clears the aiden-gw cookie + all sb-*
    // cookies across .aiden.services and redirects back to the hub
    // login. Do not clear cookies locally.
    window.location.href = `${GATEWAY_URL}/auth/logout`;
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function redirectToGatewayLogin(): void {
  window.location.href = gatewayLoginUrl();
}
