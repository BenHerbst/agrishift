import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Compass,
  Loader2,
  LocateFixed,
  MapPin,
  Search,
} from 'lucide-react';
import { PRESET_REGIONS } from '../data/presets';
import { LanguageSwitcher, useI18n } from '../i18n/I18nContext';
import { PRESET_TEXT } from '../i18n/translations';
import {
  getCurrentBrowserLocation,
  searchPlaces,
  type GeocodingResult,
} from '../services/geocodingService';
import type { PresetRegion } from '../types/terrashift';
import type { LegalRoute } from './LegalPage';

interface LocationOnboardingProps {
  onConfirmLocation: (selection: {
    lat: number;
    lon: number;
    label?: string;
    preset?: PresetRegion;
  }) => void;
  onNavigateLegal: (path: LegalRoute) => void;
}

export function LocationOnboarding({
  onConfirmLocation,
  onNavigateLegal,
}: LocationOnboardingProps) {
  const { lang, t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [showCoordEntry, setShowCoordEntry] = useState(false);
  const [latInput, setLatInput] = useState('50.7753');
  const [lonInput, setLonInput] = useState('6.0839');

  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setIsSearching(true);
      try {
        const matches = await searchPlaces(trimmed, controller.signal, lang);
        if (!controller.signal.aborted) {
          setResults(matches);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 220);

    return () => {
      clearTimeout(timer);
    };
  }, [query, lang]);

  const handleUseCurrentLocation = async () => {
    setGeoError(null);
    setIsLocating(true);
    try {
      const loc = await getCurrentBrowserLocation(lang);
      onConfirmLocation({
        lat: loc.lat,
        lon: loc.lon,
        label: loc.label,
      });
    } catch (err) {
      setGeoError(err instanceof Error ? err.message : t.onboarding.noMatchError);
    } finally {
      setIsLocating(false);
    }
  };

  const handleSearchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGeoError(null);
    if (results.length > 0) {
      const first = results[0];
      onConfirmLocation({
        lat: first.lat,
        lon: first.lon,
        label: first.displayLabel,
      });
      return;
    }
    if (query.trim().length >= 2) {
      setIsSearching(true);
      try {
        const matches = await searchPlaces(query.trim(), undefined, lang);
        if (matches.length > 0) {
          onConfirmLocation({
            lat: matches[0].lat,
            lon: matches[0].lon,
            label: matches[0].displayLabel,
          });
        } else {
          setGeoError(t.onboarding.noMatchError);
        }
      } finally {
        setIsSearching(false);
      }
    }
  };

  const handleCoordSubmit = (e: FormEvent) => {
    e.preventDefault();
    setGeoError(null);
    const lat = Number.parseFloat(latInput);
    const lon = Number.parseFloat(lonInput);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -85 ||
      lat > 85 ||
      lon < -180 ||
      lon > 180
    ) {
      setGeoError(t.onboarding.coordInvalid);
      return;
    }
    onConfirmLocation({ lat, lon });
  };

  return (
    <div className="min-h-screen bg-[#111316] text-[#ECEEF0] flex flex-col">
      <header className="border-b border-[#262B33] bg-[#111316]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-4 sm:px-6 py-3.5">
          <span className="font-mono text-sm font-semibold tracking-wider text-[#ECEEF0] whitespace-nowrap">
            Terra Tuta
          </span>
          <div className="flex items-center gap-5">
            <span className="font-mono text-[11px] text-[#7C8490] hidden md:inline">
              {t.onboarding.tagline}
            </span>
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1320px] flex-1 items-center px-4 sm:px-6 py-10 lg:py-16">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left 7 Columns: Editorial Briefing + Direct Search */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-3">
              <div className="font-mono text-xs text-emerald-400">
                {t.onboarding.stepBadge}
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#ECEEF0] leading-snug">
                {t.onboarding.title}
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-[#A1A8B3]">
                {t.onboarding.subtitle}
              </p>
            </div>

            <div className="border border-[#262B33] bg-[#171A1F] p-5 sm:p-6 space-y-4">
              <div className="flex flex-col gap-3">
                <form onSubmit={handleSearchSubmit} className="relative flex flex-col sm:flex-row gap-2">
                  <label htmlFor="onboarding-place-search" className="sr-only">
                    {t.onboarding.searchPlaceholder}
                  </label>
                  <div className="relative flex-1 flex items-center">
                    <Search
                      className="pointer-events-none absolute left-3 h-4 w-4 text-[#7C8490]"
                      aria-hidden="true"
                    />
                    <input
                      id="onboarding-place-search"
                      type="text"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setGeoError(null);
                      }}
                      placeholder={t.onboarding.searchPlaceholder}
                      className="w-full rounded-[2px] border border-[#262B33] bg-[#111316] py-2.5 pl-9 pr-3 text-xs sm:text-sm text-[#ECEEF0] placeholder:text-[#7C8490] focus:border-emerald-500 focus:outline-none transition-colors duration-200 ease-out"
                      autoFocus
                    />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="submit"
                      disabled={isSearching || query.trim().length < 2}
                      className="inline-flex items-center justify-center gap-1.5 rounded-[2px] bg-emerald-500 px-3.5 py-2.5 text-xs font-medium text-[#111316] hover:bg-emerald-400 disabled:opacity-40 transition-colors duration-200 ease-out cursor-pointer whitespace-nowrap"
                    >
                      {isSearching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <>
                          <span>{t.onboarding.startBtn}</span>
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleUseCurrentLocation}
                      disabled={isLocating}
                      className="inline-flex items-center justify-center gap-2 rounded-[2px] border border-[#262B33] bg-[#111316] px-3.5 py-2.5 text-xs font-medium text-[#ECEEF0] hover:border-emerald-500/60 hover:text-emerald-300 transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                    >
                      {isLocating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <LocateFixed className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                      )}
                      <span>{isLocating ? t.onboarding.locatingBtn : t.onboarding.currentLocationBtn}</span>
                    </button>
                  </div>

                  {results.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1.5 border border-[#262B33] bg-[#111316] divide-y divide-[#262B33] max-h-60 overflow-y-auto">
                      {results.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() =>
                            onConfirmLocation({
                              lat: item.lat,
                              lon: item.lon,
                              label: item.displayLabel,
                            })
                          }
                          className="flex w-full items-center justify-between gap-4 px-3.5 py-2.5 text-left text-xs hover:bg-[#1E2229] transition-colors duration-200 ease-out cursor-pointer"
                        >
                          <span className="flex items-center gap-2 text-[#ECEEF0] min-w-0">
                            <MapPin className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                            <span className="truncate">{item.displayLabel}</span>
                          </span>
                          <span className="font-mono text-[11px] tabular-nums tracking-tight text-[#A1A8B3] shrink-0">
                            {item.lat.toFixed(4)}, {item.lon.toFixed(4)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </form>
              </div>

              {geoError && (
                <div className="rounded-[2px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {geoError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#262B33] pt-3.5 text-xs text-[#A1A8B3]">
                <span>{t.onboarding.coordPrompt}</span>
                <button
                  type="button"
                  onClick={() => setShowCoordEntry((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 font-medium text-[#ECEEF0] hover:text-emerald-300 transition-colors duration-200 ease-out cursor-pointer"
                >
                  <Compass className="h-3.5 w-3.5 text-[#A1A8B3]" aria-hidden="true" />
                  <span>{showCoordEntry ? t.onboarding.coordHide : t.onboarding.coordShow}</span>
                </button>
              </div>

              {showCoordEntry && (
                <form
                  onSubmit={handleCoordSubmit}
                  className="flex flex-wrap items-center gap-3 border border-[#262B33] bg-[#111316] p-3"
                >
                  <div className="flex items-center gap-2">
                    <label htmlFor="onboard-lat" className="font-mono text-xs text-[#A1A8B3]">
                      Lat:
                    </label>
                    <input
                      id="onboard-lat"
                      type="text"
                      value={latInput}
                      onChange={(e) => setLatInput(e.target.value)}
                      className="w-28 rounded-[2px] border border-[#262B33] bg-[#171A1F] px-2.5 py-1 font-mono text-xs tabular-nums tracking-tight text-[#ECEEF0] focus:border-emerald-500 focus:outline-none transition-colors duration-200 ease-out"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="onboard-lon" className="font-mono text-xs text-[#A1A8B3]">
                      Lon:
                    </label>
                    <input
                      id="onboard-lon"
                      type="text"
                      value={lonInput}
                      onChange={(e) => setLonInput(e.target.value)}
                      className="w-28 rounded-[2px] border border-[#262B33] bg-[#171A1F] px-2.5 py-1 font-mono text-xs tabular-nums tracking-tight text-[#ECEEF0] focus:border-emerald-500 focus:outline-none transition-colors duration-200 ease-out"
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#262B33] bg-[#171A1F] px-3 py-1 text-xs font-medium text-[#ECEEF0] hover:border-emerald-500/60 hover:text-emerald-300 transition-colors duration-200 ease-out cursor-pointer"
                  >
                    <span>{t.onboarding.coordOpen}</span>
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Right 5 Columns: Calm Vertical List of Example Regions */}
          <div className="lg:col-span-5 border border-[#262B33] bg-[#171A1F]">
            <div className="border-b border-[#262B33] px-5 py-3.5 text-xs font-medium text-[#A1A8B3]">
              {t.onboarding.presetsHeading}
            </div>
            <div className="divide-y divide-[#262B33]">
              {PRESET_REGIONS.map((preset) => {
                const localized = PRESET_TEXT[lang][preset.id];
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      onConfirmLocation({
                        lat: preset.lat,
                        lon: preset.lon,
                        label: localized?.name ?? preset.name,
                        preset,
                      })
                    }
                    className="group flex w-full flex-col gap-1.5 p-4 sm:p-5 text-left hover:bg-[#1D2128] transition-colors duration-200 ease-out cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-[#ECEEF0] group-hover:text-emerald-300 transition-colors duration-200 ease-out">
                        {localized?.name ?? preset.name}
                      </span>
                      <ArrowRight
                        className="h-4 w-4 text-[#7C8490] group-hover:text-emerald-400 shrink-0 transition-colors duration-200 ease-out"
                        aria-hidden="true"
                      />
                    </div>
                    <div className="font-mono text-[11px] tabular-nums tracking-tight text-[#7C8490]">
                      {localized?.climateZone ?? preset.climateZone} · {preset.lat.toFixed(4)},{' '}
                      {preset.lon.toFixed(4)}
                    </div>
                    <p className="text-xs leading-relaxed text-[#A1A8B3]">
                      {localized?.summary ?? preset.summary}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-[#262B33] bg-[#111316] py-4">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-[#7C8490]">
          <span>{t.footer.left}</span>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/impressum"
              onClick={(e) => {
                e.preventDefault();
                onNavigateLegal('/impressum');
              }}
              className="hover:text-[#ECEEF0] transition-colors duration-200 ease-out"
            >
              {t.footer.imprint}
            </a>
            <a
              href="/datenschutz"
              onClick={(e) => {
                e.preventDefault();
                onNavigateLegal('/datenschutz');
              }}
              className="hover:text-[#ECEEF0] transition-colors duration-200 ease-out"
            >
              {t.footer.privacy}
            </a>
            <a
              href="/cookies"
              onClick={(e) => {
                e.preventDefault();
                onNavigateLegal('/cookies');
              }}
              className="hover:text-[#ECEEF0] transition-colors duration-200 ease-out"
            >
              {t.footer.cookies}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
