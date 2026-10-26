/** Appearance preferences stay open while design and color mode are adjusted. */
import { useState, useRef, useEffect, useId } from 'react';
import { useLanguageStore } from '../../store/languageStore';
import { useThemeStore } from '../../store/themeStore';
import useT from '../../hooks/useT';
import { Check, Close, Sun, Moon, Monitor, Settings } from './Icons';

const DESIGNS = [
  { value: 'flat', label: 'settings.designFlat', description: 'settings.designFlatDesc' },
  { value: 'neumorphism', label: 'settings.designNeumorphism', description: 'settings.designNeumorphismDesc' },
];
const COLOR_MODES = [
  { value: 'light', label: 'settings.themeLight', Icon: Sun },
  { value: 'dark', label: 'settings.themeDark', Icon: Moon },
  { value: 'system', label: 'settings.themeSystem', Icon: Monitor },
];
const LANGUAGES = [
  { value: 'zh', label: 'settings.langZh' },
  { value: 'en', label: 'settings.langEn' },
];

export default function SettingsMenu() {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const design = useThemeStore((s) => s.design);
  const colorMode = useThemeStore((s) => s.colorMode);
  const setDesign = useThemeStore((s) => s.setDesign);
  const setColorMode = useThemeStore((s) => s.setColorMode);
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('focusin', onOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('focusin', onOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={triggerRef}
        className="btn btn-ghost btn-sm gap-1.5"
        aria-label={t('settings.title')}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Settings size={16} />
        <span className="hidden sm:inline">{t('settings.title')}</span>
      </button>

      {open && (
        <section id={id} className="settings-panel" aria-label={t('settings.title')}>
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <h2 className="font-semibold text-base">{t('settings.appearance')}</h2>
              <p className="text-xs text-base-content/60 mt-1">
                {t(DESIGNS.find((option) => option.value === design).label)}
                {' · '}{t(COLOR_MODES.find((option) => option.value === colorMode).label)}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-circle"
              aria-label={t('common.close')}
              onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
            >
              <Close size={14} />
            </button>
          </div>

          <fieldset>
            <legend className="settings-legend">{t('settings.design')}</legend>
            <div className="grid grid-cols-2 gap-3">
              {DESIGNS.map((option) => (
                <label className="theme-choice" key={option.value}>
                  <input
                    type="radio"
                    name={`${id}-design`}
                    value={option.value}
                    checked={design === option.value}
                    onChange={() => setDesign(option.value)}
                    className="peer sr-only"
                  />
                  <span className="theme-choice-card">
                    <span className={`theme-preview theme-preview--${option.value}`} aria-hidden="true">
                      <span className="theme-preview-sidebar"><i /><i /><i /></span>
                      <span className="theme-preview-content"><span>Aa</span><i /><i /></span>
                    </span>
                    <span className="flex items-center justify-between gap-1 text-sm font-medium mt-3">
                      {t(option.label)}
                      {design === option.value && <Check size={14} className="text-primary" />}
                    </span>
                    <span className="block text-[11px] text-base-content/60 mt-1">{t(option.description)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="settings-legend">{t('settings.colorMode')}</legend>
            <div className="settings-segmented grid grid-cols-3 gap-1" >
              {COLOR_MODES.map(({ value, label, Icon }) => (
                <label className="cursor-pointer min-w-0" key={value}>
                  <input
                    type="radio"
                    name={`${id}-color-mode`}
                    value={value}
                    checked={colorMode === value}
                    onChange={() => setColorMode(value)}
                    className="peer sr-only"
                  />
                  <span className="settings-segment flex-col gap-1.5 py-2.5">
                    <Icon size={16} />
                    <span>{t(label)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-5 pt-4 border-t border-base-content/10">
            <legend className="settings-legend float-left w-full">{t('settings.language')}</legend>
            <div className="settings-segmented grid grid-cols-2 gap-1 clear-both">
              {LANGUAGES.map(({ value, label }) => (
                <label className="cursor-pointer" key={value}>
                  <input
                    type="radio"
                    name={`${id}-language`}
                    value={value}
                    checked={language === value}
                    onChange={() => setLanguage(value)}
                    className="peer sr-only"
                  />
                  <span className="settings-segment py-2">{t(label)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      )}
    </div>
  );
}
