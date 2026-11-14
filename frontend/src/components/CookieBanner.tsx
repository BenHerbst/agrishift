import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { LegalRoute } from './LegalPage';

const CONSENT_KEY = 'terratuta_cookie_consent_v1';

interface CookieBannerProps {
  onNavigateLegal: (path: LegalRoute) => void;
}

export function CookieBanner({ onNavigateLegal }: CookieBannerProps) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CONSENT_KEY);
      if (!saved) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const handleAcknowledge = () => {
    try {
      window.localStorage.setItem(CONSENT_KEY, 'accepted');
    } catch {
      // Ignore storage error
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label={t.legal.tabs.cookies}
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-md z-40 border border-[#262B33] bg-[#171A1F] p-4 space-y-3"
    >
      <p className="text-xs leading-relaxed text-[#A1A8B3]">{t.cookieBanner.text}</p>
      <div className="flex items-center justify-end gap-2">
        <a
          href="/cookies"
          onClick={(e) => {
            e.preventDefault();
            onNavigateLegal('/cookies');
          }}
          className="rounded-[2px] border border-[#262B33] bg-[#111316] px-3 py-1.5 text-xs text-[#ECEEF0] hover:border-[#3A414D] transition-colors duration-200 ease-out"
        >
          {t.cookieBanner.learnMore}
        </a>
        <button
          type="button"
          onClick={handleAcknowledge}
          className="rounded-[2px] bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-[#111316] hover:bg-emerald-400 transition-colors duration-200 ease-out cursor-pointer"
        >
          {t.cookieBanner.accept}
        </button>
      </div>
    </div>
  );
}
