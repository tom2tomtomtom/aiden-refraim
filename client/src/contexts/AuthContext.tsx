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
    const initializeAuth = async () => {
      try {
        // Get current session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Failed to get session:', sessionError);
          return;
        }

        console.log('Initial session:', {
          hasSession: !!session,
          userId: session?.user?.id,
          hasToken: !!session?.access_token
        });

        if (session?.access_token) {
          // Verify token is valid
          const { data: { user }, error: userError } = await supabase.auth.getUser(session.access_token);
          
          if (userError || !user) {
            console.error('Invalid token, refreshing session...');
            // Try to refresh the session
            const { data: { session: freshSession }, error: refreshError } = await supabase.auth.refreshSession();
            
            if (refreshError || !freshSession?.access_token) {
              console.error('Failed to refresh session:', refreshError);
              await signOut();
              return;
            }

            console.log('Session refreshed successfully');
            setSession(freshSession);
            setUser(freshSession.user);
            setJwt(freshSession.access_token);
          } else {
            // Token is valid
            console.log('Token verified successfully');
            setSession(session);
            setUser(user);
            setJwt(session.access_token);
          }
        } else {
          // No token in session
          console.log('No token in session');
          setSession(null);
          setUser(null);
          setJwt(null);
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', { 
        event, 
        userId: session?.user?.id,
        hasToken: !!session?.access_token
      });

      if (session?.access_token) {
        // Verify the new token
        const { data: { user }, error } = await supabase.auth.getUser(session.access_token);
        
        if (error || !user) {
          console.error('Invalid token in auth change');
          await signOut();
          return;
        }

        console.log('New token verified successfully');
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
      
      // Redirect to login page
      window.location.href = '/login';
    } catch (error) {
      console.error('Error signing out:', error);
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
