import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Globe,
  Loader2,
  MapPin,
  Moon,
  Satellite,
  Sun,
} from 'lucide-react';
import { LanguageSwitcher, useI18n } from '../i18n/I18nContext';
import type { SavedField } from '../services/savedFieldsService';
import type { DrawnFieldPolygon } from '../types/terrashift';
import { SavedFieldsMenu } from './SavedFieldsMenu';

/** Wordmark: three ploughed furrows over a field line, set in expanded Archivo. */
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 text-ink">
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <rect x="1" y="1" width="22" height="22" rx="5" fill="var(--color-crop)" />
        <path d="M5 16c3-5 5-8 7-9M9 18c2.5-4.5 5-8 9-10M14 18.5c1.5-2.5 3-4.5 5-5.5" stroke="var(--color-rapeseed)" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
      <span className="text-[17px] font-extrabold leading-none tracking-tight" style={{ fontStretch: '125%' }}>
        Terra Tuta
      </span>
    </span>
  );
}

export function ThemeToggle() {
  const { lang } = useI18n();
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const label = dark
    ? lang === 'de' ? 'Helles Design' : 'Light theme'
    : lang === 'de' ? 'Dunkles Design' : 'Dark theme';
  return (
    <button
      type="button"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.dataset.theme = next ? 'dark' : 'light';
        try {
          localStorage.setItem('terra-tuta-theme', next ? 'dark' : 'light');
        } catch {
          // private mode: the choice just isn't remembered
        }
      }}
      title={label}
      aria-label={label}
      className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-line bg-panel text-ink-2 hover:text-ink hover:border-line-strong transition-colors cursor-pointer"
    >
      {dark ? <Sun className="h-3.5 w-3.5" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

interface HeaderBarProps {
  regionName: string;
  lat: number;
  lon: number;
  isLoading: boolean;
  onResetLocationStep: () => void;
  onExportCsv: () => void;
  onExportGeoJson: () => void;
  onExportPdf: () => void;
  onOpenSources: () => void;
  drawnField: DrawnFieldPolygon | null;
  onLoadSaved: (field: SavedField) => void;
}

export function HeaderBar({
  regionName,
  lat,
  lon,
  isLoading,
  onResetLocationStep,
  onExportCsv,
  onExportGeoJson,
  onExportPdf,
  drawnField,
  onLoadSaved,
  onOpenSources,
}: HeaderBarProps) {
  const { t } = useI18n();
  const [exportOpen, setExportOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const latHem = lat >= 0 ? 'N' : 'S';
  const lonHem = lon >= 0 ? 'E' : 'W';

  useEffect(() => {
    if (!exportOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [exportOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-panel/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <Wordmark />

          <span className="text-line hidden sm:inline" aria-hidden="true">
            |
          </span>

          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="h-3.5 w-3.5 text-crop shrink-0" aria-hidden="true" />
            <span className="text-xs sm:text-sm font-medium text-ink truncate max-w-[200px] sm:max-w-[320px]">
              {regionName}
            </span>
            <span className="hidden md:inline font-mono text-[11px] tabular-nums text-ink-3 shrink-0">
              ({Math.abs(lat).toFixed(3)}° {latHem}, {Math.abs(lon).toFixed(3)}° {lonHem})
            </span>
          </div>

          <button
            type="button"
            onClick={onResetLocationStep}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-ink hover:border-crop/50 hover:text-crop transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3 text-ink-2" aria-hidden="true" />
            <span>{t.toolbar.changeLocation}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 min-w-0">
          {isLoading && (
            <span role="status" title={t.toolbar.loadingData} className="inline-flex items-center text-crop">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span className="sr-only">{t.toolbar.loadingData}</span>
            </span>
          )}

          <button
            type="button"
            onClick={onOpenSources}
            aria-label={t.toolbar.dataSources}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-xs text-ink hover:border-crop/50 hover:text-crop transition-colors duration-200 ease-out cursor-pointer whitespace-nowrap"
          >
            <Satellite className="h-3.5 w-3.5 text-crop" aria-hidden="true" />
            <span className="hidden sm:inline">{t.toolbar.dataSources}</span>
          </button>

          <SavedFieldsMenu current={{ lat, lon, name: regionName, field: drawnField }} onLoad={onLoadSaved} />

          {/* Export Dropdown (CSV, GeoJSON, PDF) */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setExportOpen((prev) => !prev)}
              disabled={isLoading}
              aria-expanded={exportOpen}
              aria-haspopup="menu"
              aria-label={t.ribbon.exportMenu}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-xs text-ink hover:border-line-strong hover:text-crop transition-colors duration-200 ease-out cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 text-ink-2" aria-hidden="true" />
              <span className="hidden sm:inline">{t.ribbon.exportMenu}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-ink-2 transition-transform duration-200 ${
                  exportOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {exportOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 w-48 border border-line bg-ground divide-y divide-line z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    onExportCsv();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-ink hover:bg-raised hover:text-crop transition-colors duration-200 ease-out cursor-pointer"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-ink-2 shrink-0" aria-hidden="true" />
                  <span>{t.ribbon.exportCsv}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    onExportGeoJson();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-ink hover:bg-raised hover:text-crop transition-colors duration-200 ease-out cursor-pointer"
                >
                  <Globe className="h-3.5 w-3.5 text-ink-2 shrink-0" aria-hidden="true" />
                  <span>{t.ribbon.exportGeoJson}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    onExportPdf();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-ink hover:bg-raised hover:text-crop transition-colors duration-200 ease-out cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5 text-ink-2 shrink-0" aria-hidden="true" />
                  <span>{t.ribbon.exportPdf}</span>
                </button>
              </div>
            )}
          </div>

          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
