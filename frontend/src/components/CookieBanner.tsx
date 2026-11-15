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
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-md z-40 border border-line bg-panel p-4 space-y-3"
    >
      <p className="text-xs leading-relaxed text-ink-2">{t.cookieBanner.text}</p>
      <div className="flex items-center justify-end gap-2">
        <a
          href="/cookies"
          onClick={(e) => {
            e.preventDefault();
            onNavigateLegal('/cookies');
          }}
          className="rounded-md border border-line bg-ground px-3 py-1.5 text-xs text-ink hover:border-line-strong transition-colors duration-200 ease-out"
        >
          {t.cookieBanner.learnMore}
        </a>
        <button
          type="button"
          onClick={handleAcknowledge}
          className="rounded-md bg-crop px-3.5 py-1.5 text-xs font-semibold text-ground hover:bg-crop/90 transition-colors duration-200 ease-out cursor-pointer"
        >
          {t.cookieBanner.accept}
        </button>
      </div>
    </div>
  );
}
