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
          window.location.href = '/login?session_expired=true';
        }
      },
    ],
  },
});

// ── Auth ──────────────────────────────────────────────

export const authApi = {
  me: () => api.get('auth/me').json(),
  callback: (code, redirectUri, codeVerifier, clientId = 'llm-dlp-web') =>
    api.post('auth/callback', { json: { code, redirect_uri: redirectUri, code_verifier: codeVerifier || '', client_id: clientId } }).json(),
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

  listModels: () =>
    api.get('chat/models').json(),

  createConversation: () =>
    api.post('chat/conversations').json(),

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

// ── Files ─────────────────────────────────────────────

export const filesApi = {
  upload: (file, conversationId) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('conversation_id', conversationId);
    return api.post('files/upload', {
      body: formData,
      timeout: 120000,  // 2 min for upload + parsing
    }).json();
  },

  get: (id) =>
    api.get(`files/${id}`).json(),

  delete: (id) =>
    api.delete(`files/${id}`),
};

// ── Admin (LDAP) ─────────────────────────────────────

export const ldapApi = {
  listSources: () => api.get('admin/ldap/sources').json(),

  getSource: (id) => api.get(`admin/ldap/sources/${encodeURIComponent(id)}`).json(),

  createSource: (payload) =>
    api.post('admin/ldap/sources', { json: payload }).json(),

  updateSource: (id, payload) =>
    api.put(`admin/ldap/sources/${encodeURIComponent(id)}`, { json: payload }).json(),

  deleteSource: (id) => api.delete(`admin/ldap/sources/${encodeURIComponent(id)}`),

  syncSource: (id) =>
    api.post(`admin/ldap/sources/${encodeURIComponent(id)}/sync`).json(),
};

// ── Admin (System) ────────────────────────────────────

export const adminApi = {
  listModels: () => api.get('admin/models').json(),

  addModel: (payload) =>
    api.post('admin/models', { json: payload }).json(),

  updateModel: (id, payload) =>
    api.put(`admin/models/${encodeURIComponent(id)}`, { json: payload }).json(),

  deleteModel: (id) => api.delete(`admin/models/${encodeURIComponent(id)}`),

  getSettings: () => api.get('admin/settings').json(),

  updateSetting: (key, value) =>
    api.put('admin/settings', { json: { key, value } }).json(),
};

// ── Statistics / Usage ────────────────────────────────

export const statsApi = {
  /** Admin: aggregated token stats for all users */
  getStats: (startDate, endDate) =>
    api.get('stats', { searchParams: { start_date: startDate, end_date: endDate } }).json(),

  /** Self: current user's usage with daily breakdown */
  getMyUsage: (startDate, endDate) =>
    api.get('stats/me', { searchParams: { start_date: startDate, end_date: endDate } }).json(),

  /** Admin: view a specific user's usage */
  getUserUsage: (userId, startDate, endDate) =>
    api.get(`stats/users/${encodeURIComponent(userId)}`, { searchParams: { start_date: startDate, end_date: endDate } }).json(),
};

export default api;
