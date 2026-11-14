import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Globe,
  MapPin,
} from 'lucide-react';
import { LanguageSwitcher, useI18n } from '../i18n/I18nContext';

interface HeaderBarProps {
  regionName: string;
  lat: number;
  lon: number;
  isLoading: boolean;
  onResetLocationStep: () => void;
  onExportCsv: () => void;
  onExportGeoJson: () => void;
  onExportPdf: () => void;
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
    <header className="sticky top-0 z-50 border-b border-[#262B33] bg-[#111316]">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <span className="font-mono text-sm font-semibold tracking-wider text-[#ECEEF0] whitespace-nowrap shrink-0">
            Terra Tuta
          </span>

          <span className="text-[#262B33] hidden sm:inline" aria-hidden="true">
            |
          </span>

          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
            <span className="text-xs sm:text-sm font-medium text-[#ECEEF0] truncate max-w-[200px] sm:max-w-[320px]">
              {regionName}
            </span>
            <span className="hidden md:inline font-mono text-[11px] tabular-nums text-[#7C8490] shrink-0">
              ({Math.abs(lat).toFixed(3)}° {latHem}, {Math.abs(lon).toFixed(3)}° {lonHem})
            </span>
          </div>

          <button
            type="button"
            onClick={onResetLocationStep}
            className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#262B33] bg-[#171A1F] px-2.5 py-1 text-xs text-[#ECEEF0] hover:border-emerald-500/50 hover:text-emerald-300 transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3 text-[#A1A8B3]" aria-hidden="true" />
            <span>{t.toolbar.changeLocation}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {isLoading && (
            <span className="font-mono text-[11px] text-amber-300">
              {t.toolbar.loadingData}
            </span>
          )}

          {/* Export Dropdown (CSV, GeoJSON, PDF) */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setExportOpen((prev) => !prev)}
              disabled={isLoading}
              aria-expanded={exportOpen}
              aria-haspopup="menu"
              className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#262B33] bg-[#171A1F] px-3 py-1.5 text-xs text-[#ECEEF0] hover:border-[#3A414D] hover:text-emerald-300 transition-colors duration-200 ease-out cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 text-[#A1A8B3]" aria-hidden="true" />
              <span>{t.ribbon.exportMenu}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-[#A1A8B3] transition-transform duration-200 ${
                  exportOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {exportOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 w-48 border border-[#262B33] bg-[#111316] divide-y divide-[#262B33] z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    onExportCsv();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[#ECEEF0] hover:bg-[#1E2229] hover:text-emerald-300 transition-colors duration-200 ease-out cursor-pointer"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-[#A1A8B3] shrink-0" aria-hidden="true" />
                  <span>{t.ribbon.exportCsv}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    onExportGeoJson();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[#ECEEF0] hover:bg-[#1E2229] hover:text-emerald-300 transition-colors duration-200 ease-out cursor-pointer"
                >
                  <Globe className="h-3.5 w-3.5 text-[#A1A8B3] shrink-0" aria-hidden="true" />
                  <span>{t.ribbon.exportGeoJson}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    onExportPdf();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[#ECEEF0] hover:bg-[#1E2229] hover:text-emerald-300 transition-colors duration-200 ease-out cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5 text-[#A1A8B3] shrink-0" aria-hidden="true" />
                  <span>{t.ribbon.exportPdf}</span>
                </button>
              </div>
            )}
          </div>

          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
