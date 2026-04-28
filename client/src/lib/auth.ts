/**
 * Canonical auth exports for refrAIm client.
 *
 * Auth is Gateway SSO: the `aiden-gw` HttpOnly cookie (set by
 * www.aiden.services at login, scoped to .aiden.services) is verified
 * server-side on every request. The client never reads the JWT directly.
 *
 * Use `useAuth()` inside any component to get the current user.
 * Use `redirectToGatewayLogin()` to bounce an unauthenticated user.
 */
export {
  useAuth,
  redirectToGatewayLogin,
  AuthProvider,
  type AuthUser,
} from '../contexts/AuthContext';
