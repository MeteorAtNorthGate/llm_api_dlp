/** Key store — API key management state. */

import { create } from 'zustand';
import { keysApi } from '../services/api';

export const useKeyStore = create((set, get) => ({
  keys: [],
  isLoading: false,
  showNewKeyModal: false,
  newKeyData: null,

  loadKeys: async () => {
    set({ isLoading: true });
    try {
      const data = await keysApi.list();
      set({ keys: data.keys || [], isLoading: false });
    } catch (err) {
      console.error('Failed to load keys', err);
      set({ isLoading: false });
    }
  },

  generateKey: async (payload) => {
    set({ isLoading: true });
    try {
      const data = await keysApi.generate(payload);
      set({
        newKeyData: data,
        showNewKeyModal: true,
        isLoading: false,
      });
      await get().loadKeys();
      return data;
    } catch (err) {
      console.error('Failed to generate key', err);
      set({ isLoading: false });
      throw err;
    }
  },

  revokeKey: async (id) => {
    try {
      await keysApi.revoke(id);
      await get().loadKeys();
    } catch (err) {
      console.error('Failed to revoke key', err);
    }
  },

  deleteKey: async (id) => {
    try {
      await keysApi.delete(id);
      await get().loadKeys();
    } catch (err) {
      console.error('Failed to delete key', err);
    }
  },

  closeNewKeyModal: () => {
    set({ showNewKeyModal: false, newKeyData: null });
  },
}));
