// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createThemeRuntime, getThemeBootstrapScript } from '../styles/themeRuntime';

let systemDark;
let colorScheme;
let onSystemChange;
let onStorageChange;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  systemDark = false;
  colorScheme = {
    get matches() { return systemDark; },
    addEventListener: vi.fn((_, listener) => { onSystemChange = listener; }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => colorScheme));
  const addEventListener = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'storage') onStorageChange = listener;
    else addEventListener(type, listener, options);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const save = (state, version = 1) => localStorage.setItem('app-theme', JSON.stringify({ state, version }));
const loadStore = async () => (await import('./themeStore')).useThemeStore;

// These assertions exercise the generated blocking script, not a second bootstrap implementation.
function bootstrap() {
  new Function('window', getThemeBootstrapScript())(window);
  return document.documentElement.dataset;
}

describe('appearance persistence and pre-paint initialization', () => {
  it('starts new users in light Neumorphism before paint and after hydration', async () => {
    expect(bootstrap().theme).toBe('llmSoft');
    const store = await loadStore();
    expect(store.getState()).toMatchObject({ design: 'neumorphism', colorMode: 'light' });
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it.each([['llm', 'light'], ['llmDark', 'dark']])('migrates legacy %s without changing the visible theme', async (theme, colorMode) => {
    save({ theme }, 0);
    expect(bootstrap().theme).toBe(theme);
    const store = await loadStore();
    expect(store.getState()).toMatchObject({ design: 'flat', colorMode });
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(JSON.parse(localStorage.getItem('app-theme'))).toEqual({
      state: { design: 'flat', colorMode }, version: 1,
    });
  });

  it.each([
    ['flat', 'light', 'llm'], ['flat', 'dark', 'llmDark'],
    ['neumorphism', 'light', 'llmSoft'], ['neumorphism', 'dark', 'llmSoftDark'],
  ])('restores %s / %s identically before and after hydration', async (design, colorMode, theme) => {
    save({ design, colorMode });
    expect(bootstrap().theme).toBe(theme);
    const store = await loadStore();
    expect(store.getState()).toMatchObject({ design, colorMode });
    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  it('changes each axis independently and persists only preferences', async () => {
    const store = await loadStore();
    store.getState().setColorMode('dark');
    store.getState().setDesign('flat');
    expect(document.documentElement.dataset.theme).toBe('llmDark');
    store.getState().setDesign('neumorphism');
    expect(document.documentElement.dataset.theme).toBe('llmSoftDark');
    expect(JSON.parse(localStorage.getItem('app-theme'))).toEqual({
      state: { design: 'neumorphism', colorMode: 'dark' }, version: 1,
    });
  });

  it('follows live system changes only in system mode', async () => {
    save({ design: 'neumorphism', colorMode: 'system' });
    systemDark = true;
    expect(bootstrap().theme).toBe('llmSoftDark');
    const store = await loadStore();
    systemDark = false;
    onSystemChange();
    expect(document.documentElement.dataset.theme).toBe('llmSoft');
    store.getState().setDesign('flat');
    systemDark = true;
    onSystemChange();
    expect(document.documentElement.dataset.theme).toBe('llmDark');
    store.getState().setColorMode('light');
    onSystemChange();
    expect(document.documentElement.dataset.theme).toBe('llm');
  });

  it('rehydrates preferences changed or cleared in another tab', async () => {
    const store = await loadStore();
    save({ design: 'flat', colorMode: 'dark' });
    await onStorageChange({ key: 'app-theme' });
    expect(store.getState()).toMatchObject({ design: 'flat', colorMode: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('llmDark');
    localStorage.clear();
    await onStorageChange({ key: null });
    expect(document.documentElement.dataset.theme).toBe('llmSoft');
  });

  it.each(['{invalid', JSON.stringify({ state: { design: 'toString', colorMode: 'invalid' }, version: 1 })])('recovers from invalid storage: %s', async (raw) => {
    localStorage.setItem('app-theme', raw);
    expect(bootstrap().theme).toBe('llmSoft');
    const store = await loadStore();
    expect(store.getState()).toMatchObject({ design: 'neumorphism', colorMode: 'light' });
    expect(document.documentElement.dataset.theme).toBe('llmSoft');
  });

  it('initializes safely when localStorage access is blocked', () => {
    const browser = {
      document,
      get localStorage() { throw new Error('Storage blocked'); },
    };
    expect(createThemeRuntime(browser).initialize()).toEqual({ design: 'neumorphism', colorMode: 'light' });
    expect(document.documentElement.dataset.theme).toBe('llmSoft');
  });
});
