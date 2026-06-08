/** LoginPage — handles Keycloak OIDC redirect flow. */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Spinner from '../components/ui/Spinner';

export default function LoginPage() {
  const { isAuthenticated, isLoading, login, redirectToLogin } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  // Guard against React StrictMode double-mounting in development
  const handledRef = useRef(false);

  const loggedOut = searchParams.get('logged_out') === 'true';
  const sessionExpired = searchParams.get('session_expired') === 'true';

  useEffect(() => {
    // If we already processed the auth code or redirect, skip
    if (handledRef.current) return;

    const code = searchParams.get('code');

    if (code) {
      handledRef.current = true;
      const redirectUri = `${window.location.origin}/auth/callback`;
      const codeVerifier = sessionStorage.getItem('pkce_code_verifier') || '';
      sessionStorage.removeItem('pkce_code_verifier');

      if (!codeVerifier) {
        // PKCE verifier was already consumed (e.g., by StrictMode re-run)
        // The first invocation already handled the login — just wait
        return;
      }

      login(code, redirectUri, codeVerifier).catch((err) => {
        setError('Login failed. Please try again.');
        console.error('Login error:', err);
      });
    } else if (!isLoading && !isAuthenticated) {
      // Don't auto-redirect to Keycloak after logout or session expiry —
      // that would re-authenticate the user via the existing SSO session.
      if (!loggedOut && !sessionExpired) {
        handledRef.current = true;
        redirectToLogin();
      }
    }
  }, [isLoading, isAuthenticated, login, redirectToLogin, searchParams, loggedOut, sessionExpired]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // ── Logged-out state ──────────────────────────────────

  if (loggedOut || sessionExpired) {
    const message = sessionExpired
      ? 'Your session has expired. Please log in again.'
      : 'You have been logged out.';
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-6">
          <h1 className="text-2xl font-semibold">{message}</h1>
          <button className="btn btn-primary" onClick={redirectToLogin}>
            Login
          </button>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="alert alert-error shadow-lg max-w-md">
            <div>
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          </div>
          <button className="btn btn-primary mt-4" onClick={redirectToLogin}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <Spinner size="lg" />
        <p className="text-lg text-base-content/70">Redirecting to login...</p>
      </div>
    </div>
  );
}
