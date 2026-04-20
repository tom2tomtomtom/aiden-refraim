import { createContext, useContext, useMemo } from 'react';
import { ApiClient } from '../api';
import { useAuth } from './AuthContext';

interface ApiContextType {
  api: ApiClient | null;
}

const ApiContext = createContext<ApiContextType | undefined>(undefined);

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  // Only create API client once the Gateway session check has completed
  // and returned a user. Auth travels via the HttpOnly `aiden-gw` cookie,
  // not a client-held token, so ApiClient no longer needs one.
  const api = useMemo(() => {
    if (loading || !user) return null;
    return new ApiClient();
  }, [user, loading]);

  return (
    <ApiContext.Provider value={{ api }}>
      {children}
    </ApiContext.Provider>
  );
}

export function useApi() {
  const context = useContext(ApiContext);
  if (context === undefined) {
    throw new Error('useApi must be used within an ApiProvider');
  }
  return context;
}
