import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function Login() {
  const { user, signIn, signUp } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email address first');
      return;
    }
    setResetLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      setResetSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email');
    } finally {
      setResetLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isSignUp) {
        await signUp(email, password);
        setSignUpSuccess(true);
        setLoading(false);
        return;
      } else {
        await signIn(email, password);
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'An error occurred'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black-ink">
      <div className="max-w-md w-full space-y-8 p-8 bg-black-card border-2 border-border-subtle">
        <div>
          <h1 className="text-center text-4xl font-bold text-red-hot uppercase tracking-tight mb-2">
            AIDEN // REFRAIM
          </h1>
          <p className="text-center text-sm text-white-dim uppercase tracking-wide">
            {isSignUp ? 'Create an account' : 'Sign in to your account'}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="p-3 bg-black-deep border-2 border-red-hot">
              <p className="text-xs text-red-hot font-bold uppercase">Error</p>
              <p className="text-sm text-white-muted mt-1">{error}</p>
            </div>
          )}

          {signUpSuccess && (
            <div className="p-3 bg-black-deep border-2 border-orange-accent">
              <p className="text-xs text-orange-accent font-bold uppercase">Account Created</p>
              <p className="text-sm text-white-muted mt-1">Check your email for a confirmation link to activate your account.</p>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="email-address" className="block text-xs font-bold text-white-dim uppercase tracking-wide mb-1">
                Email
              </label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-black-deep border border-border-subtle text-white-full px-4 py-3 text-sm focus:border-red-hot focus:bg-black-ink transition-all"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-bold text-white-dim uppercase tracking-wide mb-1">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black-deep border border-border-subtle text-white-full px-4 py-3 text-sm focus:border-red-hot focus:bg-black-ink transition-all"
                placeholder="Password"
              />
              {isSignUp && (
                <p className="text-xs text-white-dim mt-1">Minimum 6 characters</p>
              )}
              {!isSignUp && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetLoading}
                  className="text-xs text-white-dim hover:text-orange-accent transition-colors mt-1 disabled:opacity-50"
                >
                  {resetLoading ? 'Sending...' : 'Forgot password?'}
                </button>
              )}
              {resetSent && (
                <p className="text-xs text-orange-accent mt-1">Reset link sent. Check your email.</p>
              )}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-red-hot text-white px-6 py-3 text-sm font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="animate-spin h-5 w-5 border-b-2 border-white mx-auto" />
              ) : isSignUp ? (
                'Sign Up'
              ) : (
                'Sign In'
              )}
            </button>
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(null); setResetSent(false); setSignUpSuccess(false); }}
              className="text-xs text-white-dim uppercase tracking-wide hover:text-orange-accent transition-colors"
            >
              {isSignUp
                ? 'Already have an account? Sign in'
                : "Don't have an account? Sign up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
