import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, redirectToGatewayLogin } from '../contexts/AuthContext';

/**
 * Legacy /login route. refrAIm no longer has its own sign-in form —
 * the AIDEN Gateway is the sole auth authority for the platform. We
 * keep the route so old deep links still resolve, but immediately
 * hand off to Gateway if the user isn't already signed in, or the
 * dashboard if they are.
 */
export function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (user) {
      navigate('/', { replace: true });
    } else {
      redirectToGatewayLogin();
    }
  }, [user, loading, navigate]);

  return (
    <div className="flex items-center justify-center h-screen bg-black-deep">
      <div className="animate-spin h-8 w-8 border-b-2 border-red-hot" />
    </div>
  );
}
