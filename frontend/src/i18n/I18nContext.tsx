import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { UI_STRINGS, type AppLanguage } from './translations';

interface I18nContextValue {
  lang: AppLanguage;
  setLang: (lang: AppLanguage) => void;
  t: (typeof UI_STRINGS)['en'] | (typeof UI_STRINGS)['de'];
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'terratuta_lang';

function detectInitialLanguage(): AppLanguage {
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'de' || saved === 'en') return saved;
    if (window.navigator.language?.toLowerCase().startsWith('de')) return 'de';
  }
  return 'de';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(detectInitialLanguage);

  const setLang = (next: AppLanguage) => {
    setLangState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = UI_STRINGS[lang].documentTitle;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t: UI_STRINGS[lang] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();

  return (
    <div
      className="inline-flex items-center rounded-[2px] border border-[#262B33] bg-[#111316] p-0.5 shrink-0"
      role="group"
      aria-label={lang === 'de' ? 'Sprachauswahl' : 'Language selection'}
    >
      <button
        type="button"
        onClick={() => setLang('de')}
        aria-pressed={lang === 'de'}
        className={`rounded-[2px] px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
          lang === 'de'
            ? 'bg-[#262B33] text-emerald-300'
            : 'text-[#A1A8B3] hover:text-[#ECEEF0]'
        }`}
      >
        DE
      </button>
      <button
        type="button"
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
        className={`rounded-[2px] px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
          lang === 'en'
            ? 'bg-[#262B33] text-emerald-300'
            : 'text-[#A1A8B3] hover:text-[#ECEEF0]'
        }`}
      >
        EN
      </button>
    </div>
  );
}
