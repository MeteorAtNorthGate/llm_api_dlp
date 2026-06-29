/** Language store — Zustand + localStorage persistence with browser detection. */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Detect the initial language on first visit:
 * 1. Check navigator.language for browser preference
 * 2. If it starts with "zh", use Simplified Chinese
 * 3. Otherwise default to Chinese (per product requirement)
 */
function detectLanguage() {
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language || '';
    // Browser says Chinese (any variant) → use zh
    if (lang.toLowerCase().startsWith('zh')) return 'zh';
  }
  // Default: Simplified Chinese
  return 'zh';
}

export const useLanguageStore = create(
  persist(
    (set) => ({
      language: detectLanguage(),
      setLanguage: (lang) => set({ language: lang }),
    }),
    {
      name: 'app-language',         // localStorage key
      onRehydrateStorage: () => {
        // If the store has been persisted before, use the persisted value.
        // Otherwise the detectLanguage() default is used.
        return (state) => {
          if (!state) return;
          // Validates that the stored language is one we support
          if (!['zh', 'en'].includes(state.language)) {
            state.language = detectLanguage();
          }
        };
      },
    }
  )
);
