import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ApiProvider } from './contexts/ApiContext';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Navbar } from './components/Navbar';

const queryClient = new QueryClient();

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ApiProvider>
          <Router>
            <div className="min-h-screen bg-gray-100">
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/"
                  element={
                    <PrivateRoute>
                      <div>
                        <Navbar />
                        <main className="container mx-auto px-4 py-8">
                          <Dashboard />
                        </main>
                      </div>
                    </PrivateRoute>
                  }
                />
              </Routes>
            </div>
          </Router>
        </ApiProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
