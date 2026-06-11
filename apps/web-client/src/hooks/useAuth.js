/** Auth hook — OIDC login flow with Keycloak + PKCE S256. */

import { useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';

const KEYCLOAK_URL = 'http://localhost:8080';
const REALM = 'llm-dlp';
const CLIENT_ID = 'llm-dlp-web';

/** Generate a cryptographically random PKCE code_verifier (43-128 chars). */
function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .slice(0, 128);
}

/** Derive S256 code_challenge from code_verifier. */
async function deriveCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function useAuth() {
  const { user, isAuthenticated, isLoading, init, login, logout } = useAuthStore();

  useEffect(() => {
    init();
  }, [init]);

  const redirectToLogin = useCallback(async () => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await deriveCodeChallenge(codeVerifier);

    // Store code_verifier for the callback exchange
    sessionStorage.setItem('pkce_code_verifier', codeVerifier);

    const authUrl =
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth` +
      `?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=openid profile email` +
      `&code_challenge=${codeChallenge}` +
      `&code_challenge_method=S256`;
    window.location.href = authUrl;
  }, []);

  return {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    redirectToLogin,
  };
}
