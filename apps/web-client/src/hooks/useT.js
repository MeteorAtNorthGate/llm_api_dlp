/** useT — lightweight translation hook backed by Zustand language store. */

import { useCallback } from 'react';
import { useLanguageStore } from '../store/languageStore';
import zh from '../locales/zh.json';
import en from '../locales/en.json';

const messages = { zh, en };

/**
 * Returns a `t(key, vars?)` function that looks up the current language's
 * translation.  Falls back to the English string, then the key itself.
 *
 * Usage:
 *   const t = useT();
 *   t('nav.chat')                    // "聊天" or "Chat"
 *   t('keys.deleteWarning', { suffix: 'abc123' })
 */
export default function useT() {
  const language = useLanguageStore((s) => s.language);

  const t = useCallback(
    (key, vars) => {
      let text = messages[language]?.[key] ?? messages.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replace(`{${k}}`, v);
        }
      }
      return text;
    },
    [language]
  );

  return t;
}

/**
 * Standalone translation function (not a hook).
 * Useful in non-component contexts where hooks cannot be used.
 * Uses the current language from the Zustand store snapshot.
 */
export function tStatic(key, vars) {
  const language = useLanguageStore.getState().language;
  let text = messages[language]?.[key] ?? messages.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

/**
 * Returns the full messages object for the current language.
 * Useful for chart labels and other data-driven translations.
 */
export function useMessages() {
  const language = useLanguageStore((s) => s.language);
  return messages[language] || messages.en;
}
