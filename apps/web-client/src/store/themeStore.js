/** Theme store — Zustand + localStorage persistence for daisyUI theme switching. */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const DEFAULT_THEME = 'llm';

function applyTheme(theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// Apply on load (as early fallback; index.html inline-script fires even earlier)
if (typeof localStorage !== 'undefined') {
  try {
    const raw = localStorage.getItem('app-theme');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.state?.theme) {
        applyTheme(parsed.state.theme);
      } else {
        applyTheme(DEFAULT_THEME);
      }
    } else {
      applyTheme(DEFAULT_THEME);
    }
  } catch {
    applyTheme(DEFAULT_THEME);
  }
} else {
  applyTheme(DEFAULT_THEME);
}

export const useThemeStore = create(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: 'app-theme',               // localStorage key
      onRehydrateStorage: () => {
        return (state) => {
          if (!state) return;
          if (!['llm', 'llmDark'].includes(state.theme)) {
            state.theme = DEFAULT_THEME;
          }
          applyTheme(state.theme);
        };
      },
    }
  )
);
