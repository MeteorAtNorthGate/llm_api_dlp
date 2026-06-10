/** LoginPage — auth source selector + Keycloak OIDC redirect flow. */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Spinner from '../components/ui/Spinner';

export default function LoginPage() {
  const { isAuthenticated, isLoading, login, redirectToLogin } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [authSource, setAuthSource] = useState('domain');

  // Guard against React StrictMode double-mounting in development
  const handledRef = useRef(false);

  const loggedOut = searchParams.get('logged_out') === 'true';
  const sessionExpired = searchParams.get('session_expired') === 'true';

  useEffect(() => {
    if (handledRef.current) return;

    const code = searchParams.get('code');

    if (code) {
      handledRef.current = true;
      const redirectUri = `${window.location.origin}/auth/callback`;
      const codeVerifier = sessionStorage.getItem('pkce_code_verifier') || '';
      sessionStorage.removeItem('pkce_code_verifier');

      if (!codeVerifier) {
        // PKCE verifier was already consumed (e.g., by StrictMode re-run)
        return;
      }

      login(code, redirectUri, codeVerifier).catch((err) => {
        setError('Login failed. Please try again.');
        console.error('Login error:', err);
      });
    }
  }, [isLoading, isAuthenticated, login, searchParams]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleLogin = () => {
    handledRef.current = true;
    redirectToLogin(authSource);
  };

  // Allow Enter key to trigger login
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  // ── Logged-out state ──────────────────────────────────

  if (loggedOut || sessionExpired) {
    const message = sessionExpired
      ? 'Your session has expired. Please log in again.'
      : 'You have been logged out.';
    return (
      <div className="flex items-center justify-center min-h-screen bg-base-200">
        <div className="card w-96 bg-base-100 shadow-xl">
          <div className="card-body items-center text-center space-y-4">
            <h1 className="text-2xl font-semibold">{message}</h1>
            <button className="btn btn-primary" onClick={handleLogin}>
              Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-base-200">
        <div className="card w-96 bg-base-100 shadow-xl">
          <div className="card-body items-center text-center space-y-4">
            <div className="alert alert-error shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
            <button className="btn btn-primary" onClick={handleLogin}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Auth source selector (landing page, no code in URL) ──

  const isCallback = !!searchParams.get('code');

  if (!isLoading && !isAuthenticated && !isCallback && !loggedOut && !sessionExpired) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-base-200" onKeyDown={handleKeyDown}>
        <div className="card w-96 bg-base-100 shadow-xl">
          <div className="card-body items-center text-center space-y-5">
            <h1 className="text-2xl font-bold">LLM Platform</h1>
            <p className="text-base-content/70">Select authentication method</p>

            {/* Auth Source Dropdown */}
            <div className="form-control w-full max-w-xs">
              <select
                className="select select-bordered w-full"
                value={authSource}
                onChange={(e) => setAuthSource(e.target.value)}
              >
                <option value="domain">
                  域控登录 (Windows AD)
                </option>
                <option value="local">
                  本地账号 (Local)
                </option>
              </select>
            </div>

            <button className="btn btn-primary w-full" onClick={handleLogin}>
              Login
            </button>

            <p className="text-xs text-base-content/50">
              {authSource === 'domain'
                ? 'Use your Windows domain account (same as Windows login)'
                : 'Use your local platform account'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading state (code exchange or initial redirect) ──

  return (
    <div className="flex items-center justify-center min-h-screen bg-base-200">
      <div className="text-center space-y-4">
        <Spinner size="lg" />
        <p className="text-lg text-base-content/70">
          {isCallback ? 'Completing login...' : 'Redirecting to login...'}
        </p>
      </div>
    </div>
  );
}
