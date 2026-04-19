import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  jwt: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tryGatewaySSO = async (): Promise<boolean> => {
      if (!window.location.hostname.endsWith('.aiden.services')) return false;
      try {
        const res = await fetch('https://www.aiden.services/api/auth/session', {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return false;
        const data = await res.json();
        // Gateway returns { jwt, user, cookies }. The cookies are Set-Cookie'd
        // on .aiden.services by the fetch (credentials: 'include' + CORS
        // allow-credentials on the Gateway response), so Supabase's cookie
        // store should now have a session. The previous code looked for
        // data.access_token / data.refresh_token which Gateway never
        // returned, so SSO silently failed and we always fell through to
        // the local login wall.
        if (data.jwt && data.user) {
          const { data: sessionData } = await supabase.auth.getSession();
          return !!sessionData.session;
        }
        return false;
      } catch {
        return false;
      }
    };

    const initializeAuth = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          await tryGatewaySSO();
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          if (retrySession?.access_token) {
            setSession(retrySession);
            setUser(retrySession.user);
            setJwt(retrySession.access_token);
          }
          return;
        }

        if (session?.access_token) {
          const { data: { user }, error: userError } = await supabase.auth.getUser(session.access_token);
          
          if (userError || !user) {
            const { data: { session: freshSession }, error: refreshError } = await supabase.auth.refreshSession();
            
            if (refreshError || !freshSession?.access_token) {
              await signOut();
              return;
            }

            setSession(freshSession);
            setUser(freshSession.user);
            setJwt(freshSession.access_token);
          } else {
            setSession(session);
            setUser(user);
            setJwt(session.access_token);
          }
        } else {
          const ssoWorked = await tryGatewaySSO();
          if (ssoWorked) {
            const { data: { session: ssoSession } } = await supabase.auth.getSession();
            if (ssoSession?.access_token) {
              setSession(ssoSession);
              setUser(ssoSession.user);
              setJwt(ssoSession.access_token);
              return;
            }
          }
          setSession(null);
          setUser(null);
          setJwt(null);
        }
      } catch {
        // Auth initialization failed silently
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.access_token) {
        const { data: { user }, error } = await supabase.auth.getUser(session.access_token);
        
        if (error || !user) {
          await signOut();
          return;
        }

        setSession(session);
        setUser(user);
        setJwt(session.access_token);
      } else {
        setSession(null);
        setUser(null);
        setJwt(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
  };

  const signOut = async () => {
    try {
      // Sign out from Supabase
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      // Clear session and user state
      setSession(null);
      setUser(null);

      // Clear any stored auth data from localStorage
      localStorage.removeItem('supabase.auth.token');
      
      // Redirect to Gateway for centralized logout
      window.location.href = 'https://www.aiden.services/auth/logout';
    } catch (error) {
      throw error;
    }
  };

  const value = {
    user,
    session,
    jwt,
    signIn,
    signUp,
    signOut,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
