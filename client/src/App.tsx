import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth, redirectToGatewayLogin } from './contexts/AuthContext';
import { ApiProvider } from './contexts/ApiContext';
import { VideoProvider } from './contexts/VideoContext';
import { FocusPointsProvider } from './contexts/FocusPointsContext';
import { ScanProvider } from './contexts/ScanContext';
import { Navbar } from './components/Navbar';

const Dashboard = React.lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Login = React.lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Editor = React.lazy(() => import('./pages/Editor'));
const ExportPage = React.lazy(() => import('./pages/Export'));

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean; error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black-ink flex items-center justify-center">
          <div className="bg-black-card border-2 border-red-hot p-8 max-w-md text-center">
            <h1 className="text-red-hot text-xl font-bold uppercase mb-4">Something went wrong</h1>
            <p className="text-white-muted text-sm mb-4">{this.state.error?.message}</p>
            <button onClick={() => window.location.href = '/'} className="bg-red-hot text-white px-6 py-3 text-sm font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all">
              Back to Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient();

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      redirectToGatewayLogin();
    }
  }, [loading, user]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin h-8 w-8 border-b-2 border-red-hot" />
      </div>
    );
  }

  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ApiProvider>
          <Router>
            <ErrorBoundary>
            <React.Suspense fallback={
              <div className="flex items-center justify-center h-screen bg-black-deep">
                <div className="animate-spin h-8 w-8 border-b-2 border-red-hot" />
              </div>
            }>
            {/* Skip-to-content link: visually hidden until focused by keyboard users */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-red-hot focus:text-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:uppercase focus:tracking-wide"
            >
              Skip to content
            </a>
            <div className="min-h-screen bg-black-deep">
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/"
                  element={
                    <PrivateRoute>
                      <div>
                        <Navbar />
                        <main id="main-content" className="container mx-auto px-4 py-8">
                          <Dashboard />
                        </main>
                      </div>
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/editor/:videoId"
                  element={
                    <PrivateRoute>
                      <div id="main-content">
                        <Navbar />
                        <VideoProvider>
                          <FocusPointsProvider>
                            <ScanProvider>
                              <Editor />
                            </ScanProvider>
                          </FocusPointsProvider>
                        </VideoProvider>
                      </div>
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/export/:videoId"
                  element={
                    <PrivateRoute>
                      <div id="main-content">
                        <Navbar />
                        <VideoProvider>
                          <FocusPointsProvider>
                            <ExportPage />
                          </FocusPointsProvider>
                        </VideoProvider>
                      </div>
                    </PrivateRoute>
                  }
                />
                <Route
                  path="*"
                  element={
                    <div className="min-h-screen bg-black-deep flex items-center justify-center">
                      <div className="bg-black-card border-2 border-red-hot p-8 max-w-md text-center">
                        <h1 className="text-red-hot text-6xl font-bold mb-4">404</h1>
                        <p className="text-white-muted text-sm uppercase tracking-wide mb-6">Page not found</p>
                        <a
                          href="/"
                          className="inline-block bg-red-hot text-white px-6 py-3 text-sm font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all"
                        >
                          Back to Dashboard
                        </a>
                      </div>
                    </div>
                  }
                />
              </Routes>
            </div>
            </React.Suspense>
            </ErrorBoundary>
          </Router>
        </ApiProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
