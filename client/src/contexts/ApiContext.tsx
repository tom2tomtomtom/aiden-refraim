import { createContext, useContext, useMemo } from 'react';
import { ApiClient } from '../api';
import { useAuth } from './AuthContext';

interface ApiContextType {
  api: ApiClient | null;
}

const ApiContext = createContext<ApiContextType | undefined>(undefined);

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const { jwt, loading } = useAuth();
  
  // Only create API client if we have a valid JWT
  const api = useMemo(() => {
    if (loading || !jwt) return null;
    return new ApiClient(jwt);
  }, [jwt, loading]);

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
