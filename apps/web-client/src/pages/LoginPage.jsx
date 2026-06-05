/** LoginPage — handles Keycloak OIDC redirect flow. */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Spinner from '../components/ui/Spinner';

export default function LoginPage() {
  const { isAuthenticated, isLoading, login, redirectToLogin } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('session_state');

    if (code) {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const codeVerifier = sessionStorage.getItem('pkce_code_verifier') || '';
      sessionStorage.removeItem('pkce_code_verifier');

      login(code, redirectUri, codeVerifier).catch((err) => {
        setError('Login failed. Please try again.');
        console.error('Login error:', err);
      });
    } else if (!isLoading && !isAuthenticated) {
      // No code — redirect to Keycloak
      redirectToLogin();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

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

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <Spinner size="lg" />
        <p className="text-lg text-base-content/70">Redirecting to login...</p>
      </div>
    </div>
  );
}
