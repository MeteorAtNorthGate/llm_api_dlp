/** SettingsMenu — dropdown with Language and Theme submenus. */

import { useState, useRef, useEffect } from 'react';
import { useLanguageStore } from '../../store/languageStore';
import { useThemeStore } from '../../store/themeStore';
import useT from '../../hooks/useT';

const LANGUAGES = [
  { value: 'zh', labelKey: 'settings.langZh' },
  { value: 'en', labelKey: 'settings.langEn' },
];

const THEMES = [
  { value: 'llm',     labelKey: 'settings.themeLight' },
  { value: 'llmDark', labelKey: 'settings.themeDark' },
];

export default function SettingsMenu() {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(null); // 'lang' | 'theme' | null
  const menuRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
        setExpanded(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (section) => {
    setExpanded((prev) => (prev === section ? null : section));
  };

  const handleSelectLang = (lang) => {
    setLanguage(lang);
    setExpanded(null);
    setOpen(false);
  };

  const handleSelectTheme = (th) => {
    setTheme(th);
    setExpanded(null);
    setOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* ── Trigger button ── */}
      <button
        className="btn btn-ghost btn-sm gap-1.5"
        onClick={() => {
          setOpen((v) => !v);
          if (open) setExpanded(null);
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span className="hidden sm:inline">{t('settings.title')}</span>
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-base-100 rounded-box shadow-lg border border-base-300 overflow-hidden">
          {/* ── Language section ── */}
          <button
            className="flex items-center justify-between w-full px-4 py-2.5 text-sm font-medium hover:bg-base-200 transition-colors"
            onClick={() => toggle('lang')}
          >
            <span>{t('settings.language')}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-base-content/50">
                {LANGUAGES.find((l) => l.value === language)?.labelKey
                  ? t(LANGUAGES.find((l) => l.value === language).labelKey)
                  : language}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12" height="12" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                className={`transition-transform ${expanded === 'lang' ? 'rotate-90' : ''}`}
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </button>

          {expanded === 'lang' && (
            <div className="border-t border-base-200 bg-base-200/50 py-1">
              {LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  className={`flex items-center w-full px-4 py-1.5 text-sm transition-colors hover:bg-base-300/50 ${
                    language === l.value ? 'font-semibold text-primary' : 'text-base-content/80'
                  }`}
                  onClick={() => handleSelectLang(l.value)}
                >
                  <span className="w-5 text-left mr-2">
                    {language === l.value ? '✓' : ''}
                  </span>
                  {t(l.labelKey)}
                </button>
              ))}
            </div>
          )}

          {/* ── Theme section ── */}
          <button
            className="flex items-center justify-between w-full px-4 py-2.5 text-sm font-medium hover:bg-base-200 transition-colors border-t border-base-200"
            onClick={() => toggle('theme')}
          >
            <span>{t('settings.theme')}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-base-content/50">
                {THEMES.find((th) => th.value === theme)?.labelKey
                  ? t(THEMES.find((th) => th.value === theme).labelKey)
                  : theme}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12" height="12" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                className={`transition-transform ${expanded === 'theme' ? 'rotate-90' : ''}`}
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </button>

          {expanded === 'theme' && (
            <div className="border-t border-base-200 bg-base-200/50 py-1">
              {THEMES.map((th) => (
                <button
                  key={th.value}
                  className={`flex items-center w-full px-4 py-1.5 text-sm transition-colors hover:bg-base-300/50 ${
                    theme === th.value ? 'font-semibold text-primary' : 'text-base-content/80'
                  }`}
                  onClick={() => handleSelectTheme(th.value)}
                >
                  <span className="w-5 text-left mr-2">
                    {theme === th.value ? '✓' : ''}
                  </span>
                  {t(th.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
