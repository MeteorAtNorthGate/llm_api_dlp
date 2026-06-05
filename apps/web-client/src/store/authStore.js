/** Auth store — JWT token management and user profile. */

import { create } from 'zustand';
import { authApi } from '../services/api';

export const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (code, redirectUri, codeVerifier) => {
    const data = await authApi.callback(code, redirectUri, codeVerifier);
    localStorage.setItem('access_token', data.access_token);
    if (data.refresh_token) {
      localStorage.setItem('refresh_token', data.refresh_token);
    }
    // Mark authenticated immediately — token is valid from Keycloak
    set({ isAuthenticated: true, isLoading: false });
    // Fetch user profile in background; failure won't invalidate the token
    get().fetchUser();
  },

  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    set({ user: null, isAuthenticated: false });

    // Redirect to Keycloak logout
    const keycloakUrl = 'http://localhost:8080';
    const realm = 'llm-dlp';
    window.location.href = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/logout?redirect_uri=${encodeURIComponent(window.location.origin)}`;
  },

  fetchUser: async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      set({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }
    try {
      const user = await authApi.me();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      // /auth/me failed (network issue, etc.) — keep the token,
      // actual JWT validation happens server-side on each request
      const stillHaveToken = !!localStorage.getItem('access_token');
      set({ isAuthenticated: stillHaveToken, isLoading: false });
    }
  },

  init: async () => {
    await get().fetchUser();
  },
}));
