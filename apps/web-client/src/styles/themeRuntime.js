/** Shared by the pre-paint script and the store. Keep this function self-contained. */
export function createThemeRuntime(browser) {
  const storageKey = 'app-theme';
  const themes = {
    flat: { light: 'llm', dark: 'llmDark' },
    neumorphism: { light: 'llmSoft', dark: 'llmSoftDark' },
  };
  const defaults = { design: 'neumorphism', colorMode: 'light' };

  function normalize(state) {
    if (!state || typeof state !== 'object') return { ...defaults };
    // Version 0 stored only a daisyUI theme name. Preserve its exact appearance.
    if (!state.design && ['llm', 'llmDark'].includes(state.theme)) {
      return { design: 'flat', colorMode: state.theme === 'llmDark' ? 'dark' : 'light' };
    }
    return {
      design: Object.hasOwn(themes, state.design) ? state.design : defaults.design,
      colorMode: ['light', 'dark', 'system'].includes(state.colorMode)
        ? state.colorMode : defaults.colorMode,
    };
  }

  function apply(state) {
    const preferences = normalize(state);
    const mode = preferences.colorMode === 'system'
      ? (browser?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preferences.colorMode;
    const root = browser?.document?.documentElement;
    if (root) {
      root.dataset.design = preferences.design;
      root.dataset.colorMode = mode;
      root.dataset.theme = themes[preferences.design][mode];
      root.style.colorScheme = mode;
    }
    return preferences;
  }

  function initialize() {
    let saved;
    try {
      saved = JSON.parse(browser?.localStorage.getItem(storageKey) || 'null')?.state;
    } catch { /* Storage can be unavailable or contain invalid JSON. */ }
    return apply(saved);
  }

  return { storageKey, normalize, apply, initialize };
}

export function getThemeBootstrapScript() {
  return `;(${createThemeRuntime.toString()})(window).initialize();`;
}
