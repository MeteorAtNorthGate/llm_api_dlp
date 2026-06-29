/** LanguageToggle — sliding pill switch for zh / en. */

import { useLanguageStore } from '../../store/languageStore';
import useT from '../../hooks/useT';

export default function LanguageToggle() {
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const t = useT();

  const isZh = language === 'zh';

  return (
    <button
      className="relative inline-flex items-center h-7 w-14 rounded-full bg-base-300 cursor-pointer select-none border-none outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => setLanguage(isZh ? 'en' : 'zh')}
      title={t('lang.switch')}
      aria-label={t('lang.switch')}
    >
      {/* Sliding pill */}
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-primary shadow-sm transition-all duration-200 ease-in-out ${
          isZh ? 'left-0.5' : 'left-[calc(100%-1.625rem)]'
        }`}
      />
      {/* Labels */}
      <span
        className={`absolute left-1.5 text-[10px] font-bold transition-colors duration-200 ${
          isZh ? 'text-primary-content' : 'text-base-content/50'
        }`}
      >
        {t('lang.zh')}
      </span>
      <span
        className={`absolute right-1.5 text-[10px] font-bold transition-colors duration-200 ${
          !isZh ? 'text-primary-content' : 'text-base-content/50'
        }`}
      >
        {t('lang.en')}
      </span>
    </button>
  );
}
