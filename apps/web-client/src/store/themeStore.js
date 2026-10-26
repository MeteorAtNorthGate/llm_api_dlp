/** Design style and color mode are independent, persisted preferences. */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createThemeRuntime } from '../styles/themeRuntime';

const browser = typeof window !== 'undefined' ? window : undefined;
const runtime = createThemeRuntime(browser);
const initialPreferences = runtime.initialize();

export const useThemeStore = create(
  persist(
    (set) => ({
      ...initialPreferences,
      setDesign: (design) => set((state) => runtime.normalize({ ...state, design })),
      setColorMode: (colorMode) => set((state) => runtime.normalize({ ...state, colorMode })),
    }),
    {
      name: runtime.storageKey,
      version: 1,
      partialize: ({ design, colorMode }) => ({ design, colorMode }),
      migrate: (saved) => runtime.normalize(saved),
      merge: (saved, current) => ({ ...current, ...runtime.normalize(saved) }),
      onRehydrateStorage: () => (state) => {
        if (state) runtime.apply(state);
      },
    }
  )
);

const unsubscribe = useThemeStore.subscribe((state) => runtime.apply(state));
const colorScheme = browser?.matchMedia?.('(prefers-color-scheme: dark)');
const onSystemChange = () => runtime.apply(useThemeStore.getState());
const onStorageChange = (event) => {
  if (event.key === runtime.storageKey || event.key === null) {
    useThemeStore.persist.rehydrate();
  }
};
colorScheme?.addEventListener('change', onSystemChange);
browser?.addEventListener('storage', onStorageChange);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribe();
    colorScheme?.removeEventListener('change', onSystemChange);
    browser?.removeEventListener('storage', onStorageChange);
  });
}
