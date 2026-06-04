/** API client — wraps ky with JWT auth handling. */

import ky from 'ky';

const API_BASE = '/api/v1';

const api = ky.create({
  prefixUrl: API_BASE,
  hooks: {
    beforeRequest: [
      (request) => {
        const token = localStorage.getItem('access_token');
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }
      },
    ],
    afterResponse: [
      async (request, options, response) => {
        if (response.status === 401) {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
      },
    ],
  },
});

// ── Auth ──────────────────────────────────────────────

export const authApi = {
  me: () => api.get('auth/me').json(),
  callback: (code, redirectUri) =>
    api.post('auth/callback', { json: { code, redirect_uri: redirectUri } }).json(),
  refresh: (refreshToken) =>
    api.post('auth/refresh', { json: { refresh_token: refreshToken } }).json(),
};

// ── Chat ──────────────────────────────────────────────

export const chatApi = {
  completions: (payload) =>
    api.post('chat/completions', {
      json: payload,
      timeout: 300000,
    }),

  listConversations: () =>
    api.get('chat/conversations').json(),

  getConversation: (id) =>
    api.get(`chat/conversations/${id}`).json(),

  deleteConversation: (id) =>
    api.delete(`chat/conversations/${id}`),
};

// ── API Keys ──────────────────────────────────────────

export const keysApi = {
  list: () => api.get('keys').json(),

  generate: (payload) =>
    api.post('keys/generate', { json: payload }).json(),

  revoke: (id) => api.delete(`keys/${id}`),
};

export default api;
