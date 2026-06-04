/** Auth hook — OIDC login flow with Keycloak. */

import { useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';

const KEYCLOAK_URL = 'http://localhost:8080';
const REALM = 'llm-dlp';
const CLIENT_ID = 'llm-dlp-web';

export function useAuth() {
  const { user, isAuthenticated, isLoading, init, login, logout } = useAuthStore();

  useEffect(() => {
    init();
  }, [init]);

  const redirectToLogin = useCallback(() => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    const authUrl =
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth` +
      `?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=openid profile email`;
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
