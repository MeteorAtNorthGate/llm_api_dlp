/** LoginPage — auto-redirects to Keycloak OIDC, handles callback. */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Spinner from '../components/ui/Spinner';
import useT from '../hooks/useT';

export default function LoginPage() {
  const { isAuthenticated, isLoading, login, redirectToLogin } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const t = useT();

  const callbackRef = useRef(false);
  const redirectedRef = useRef(false);

  const isCallback = !!searchParams.get('code');

  // ── OIDC callback handler ─────────────────────────────

  useEffect(() => {
    if (callbackRef.current) return;

    const code = searchParams.get('code');
    if (!code) return;

    callbackRef.current = true;
    const redirectUri = `${window.location.origin}/auth/callback`;
    const codeVerifier = sessionStorage.getItem('pkce_code_verifier') || '';
    sessionStorage.removeItem('pkce_code_verifier');

    if (!codeVerifier) return; // PKCE verifier already consumed (StrictMode)

    login(code, redirectUri, codeVerifier).catch((err) => {
      setError(t('login.failed'));
      console.error('Login error:', err);
    });
  }, [login, searchParams]);

  // ── Redirect to app once authenticated ────────────────

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // ── Auto-redirect to Keycloak login ───────────────────

  useEffect(() => {
    if (redirectedRef.current) return;
    if (isLoading || isAuthenticated || isCallback) return;

    redirectedRef.current = true;
    redirectToLogin();
  }, [isLoading, isAuthenticated, isCallback, redirectToLogin]);

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
            <button className="btn btn-primary" onClick={() => { callbackRef.current = false; setError(null); }}>
              {t('login.tryAgain')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading spinner (code exchange or initial redirect) ──

  return (
    <div className="flex items-center justify-center min-h-screen bg-base-200">
      <div className="text-center space-y-4">
        <Spinner size="lg" />
        <p className="text-lg text-base-content/70">
          {isCallback ? t('login.completing') : t('login.redirecting')}
        </p>
      </div>
    </div>
  );
}
