import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Compass,
  Loader2,
  LocateFixed,
  MapPin,
  Search,
  Trash2,
  Satellite,
  CloudSun,
  Layers,
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
import { ThemeToggle, Wordmark } from './HeaderBar';
import { FieldGlyph, savedFieldMeta } from './SavedFieldsMenu';
import { useSavedFields, type SavedField } from '../services/savedFieldsService';

interface LocationOnboardingProps {
  onConfirmLocation: (selection: {
    lat: number;
    lon: number;
    label?: string;
    preset?: PresetRegion;
  }) => void;
  onLoadSaved: (field: SavedField) => void;
  onNavigateLegal: (path: LegalRoute) => void;
}

export function LocationOnboarding({
  onConfirmLocation,
  onLoadSaved,
  onNavigateLegal,
}: LocationOnboardingProps) {
  const { lang, t } = useI18n();
  const { fields: savedFields, remove: removeSaved } = useSavedFields();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [showCoordEntry, setShowCoordEntry] = useState(false);
  const [latInput, setLatInput] = useState('50.8836');
  const [lonInput, setLonInput] = useState('6.3053');

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
    <div className="min-h-screen bg-ground text-ink flex flex-col">
      <header className="border-b border-line bg-ground">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-4 sm:px-6 py-3.5">
          <Wordmark />
          <div className="flex items-center gap-5">
            <span className="font-mono text-[11px] text-ink-3 hidden md:inline">
              {t.onboarding.tagline}
            </span>
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1320px] flex-1 items-center px-4 sm:px-6 py-10 lg:py-16">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left 7 Columns: Editorial Briefing + Direct Search */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-3">
              <div className="font-mono text-xs text-crop">
                {t.onboarding.stepBadge}
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink leading-snug">
                {t.onboarding.title}
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-ink-2">
                {t.onboarding.subtitle}
              </p>
            </div>

            <div className="border border-line bg-panel p-5 sm:p-6 space-y-4">
              <div className="flex flex-col gap-3">
                <form onSubmit={handleSearchSubmit} className="relative flex flex-col sm:flex-row gap-2">
                  <label htmlFor="onboarding-place-search" className="sr-only">
                    {t.onboarding.searchPlaceholder}
                  </label>
                  <div className="relative flex-1 flex items-center">
                    <Search
                      className="pointer-events-none absolute left-3 h-4 w-4 text-ink-3"
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
                      className="w-full rounded-md border border-line bg-ground py-2.5 pl-9 pr-3 text-xs sm:text-sm text-ink placeholder:text-ink-3 focus:border-crop focus:outline-none transition-colors duration-200 ease-out"
                      autoFocus
                    />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="submit"
                      disabled={isSearching || query.trim().length < 2}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-crop px-3.5 py-2.5 text-xs font-medium text-ground hover:bg-crop/90 disabled:opacity-40 transition-colors duration-200 ease-out cursor-pointer whitespace-nowrap"
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
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-line bg-ground px-3.5 py-2.5 text-xs font-medium text-ink hover:border-crop/60 hover:text-crop transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                    >
                      {isLocating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <LocateFixed className="h-3.5 w-3.5 text-crop" aria-hidden="true" />
                      )}
                      <span>{isLocating ? t.onboarding.locatingBtn : t.onboarding.currentLocationBtn}</span>
                    </button>
                  </div>

                  {results.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1.5 border border-line bg-ground divide-y divide-line max-h-60 overflow-y-auto">
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
                          className="flex w-full items-center justify-between gap-4 px-3.5 py-2.5 text-left text-xs hover:bg-raised transition-colors duration-200 ease-out cursor-pointer"
                        >
                          <span className="flex items-center gap-2 text-ink min-w-0">
                            <MapPin className="h-3.5 w-3.5 text-crop shrink-0" aria-hidden="true" />
                            <span className="truncate">{item.displayLabel}</span>
                          </span>
                          <span className="font-mono text-[11px] tabular-nums tracking-tight text-ink-2 shrink-0">
                            {item.lat.toFixed(4)}, {item.lon.toFixed(4)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </form>
              </div>

              {geoError && (
                <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                  {geoError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5 text-xs text-ink-2">
                <span>{t.onboarding.coordPrompt}</span>
                <button
                  type="button"
                  onClick={() => setShowCoordEntry((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-crop transition-colors duration-200 ease-out cursor-pointer"
                >
                  <Compass className="h-3.5 w-3.5 text-ink-2" aria-hidden="true" />
                  <span>{showCoordEntry ? t.onboarding.coordHide : t.onboarding.coordShow}</span>
                </button>
              </div>

              {showCoordEntry && (
                <form
                  onSubmit={handleCoordSubmit}
                  className="flex flex-wrap items-center gap-3 border border-line bg-ground p-3"
                >
                  <div className="flex items-center gap-2">
                    <label htmlFor="onboard-lat" className="font-mono text-xs text-ink-2">
                      Lat:
                    </label>
                    <input
                      id="onboard-lat"
                      type="text"
                      value={latInput}
                      onChange={(e) => setLatInput(e.target.value)}
                      className="w-28 rounded-md border border-line bg-panel px-2.5 py-1 font-mono text-xs tabular-nums tracking-tight text-ink focus:border-crop focus:outline-none transition-colors duration-200 ease-out"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="onboard-lon" className="font-mono text-xs text-ink-2">
                      Lon:
                    </label>
                    <input
                      id="onboard-lon"
                      type="text"
                      value={lonInput}
                      onChange={(e) => setLonInput(e.target.value)}
                      className="w-28 rounded-md border border-line bg-panel px-2.5 py-1 font-mono text-xs tabular-nums tracking-tight text-ink focus:border-crop focus:outline-none transition-colors duration-200 ease-out"
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1 text-xs font-medium text-ink hover:border-crop/60 hover:text-crop transition-colors duration-200 ease-out cursor-pointer"
                  >
                    <span>{t.onboarding.coordOpen}</span>
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                </form>
              )}
            </div>

            {/* What the site analysis is built from */}
            <ul className="mt-8 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
              {t.onboarding.facts.map((fact, i) => {
                const Icon = [Satellite, CloudSun, Layers][i] ?? Layers;
                return (
                  <li key={fact.title} className="bg-panel p-4">
                    <Icon className="h-4 w-4 text-crop" aria-hidden="true" />
                    <p className="mt-2 text-sm font-semibold text-ink">{fact.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-2">{fact.text}</p>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Right 5 Columns: saved fields first, then example regions */}
          <div className="lg:col-span-5 flex flex-col gap-4">
          {savedFields.length > 0 && (
            <div className="rounded-md border border-crop/35 bg-panel">
              <div className="flex items-baseline justify-between border-b border-line px-5 py-3.5">
                <span className="text-xs font-semibold text-crop">{t.saved.menu}</span>
                <span className="text-[11px] text-ink-3">{t.saved.localNote}</span>
              </div>
              <ul className="max-h-[260px] overflow-y-auto divide-y divide-line">
                {savedFields.map((f) => (
                  <li key={f.id} className="group flex items-center pr-3">
                    <button
                      type="button"
                      onClick={() => onLoadSaved(f)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3 text-left hover:bg-raised transition-colors cursor-pointer"
                    >
                      <FieldGlyph field={f.field} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink group-hover:text-crop">{f.name}</span>
                        <span className="block text-xs tabular-nums text-ink-3">{savedFieldMeta(f, t.saved.point)}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-ink-3 group-hover:text-crop" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSaved(f.id)}
                      aria-label={`${t.saved.remove}: ${f.name}`}
                      title={t.saved.remove}
                      className="rounded-md p-1.5 text-ink-3 opacity-60 hover:bg-warn/10 hover:text-warn group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-md border border-line bg-panel">
            <div className="border-b border-line px-5 py-3.5 text-xs font-medium text-ink-2">
              {t.onboarding.presetsHeading}
            </div>
            <div className="divide-y divide-line">
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
                    className="group flex w-full flex-col gap-1.5 p-4 sm:p-5 text-left hover:bg-raised transition-colors duration-200 ease-out cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-ink group-hover:text-crop transition-colors duration-200 ease-out">
                        {localized?.name ?? preset.name}
                      </span>
                      <ArrowRight
                        className="h-4 w-4 text-ink-3 group-hover:text-crop shrink-0 transition-colors duration-200 ease-out"
                        aria-hidden="true"
                      />
                    </div>
                    <div className="font-mono text-[11px] tabular-nums tracking-tight text-ink-3">
                      {localized?.climateZone ?? preset.climateZone} · {preset.lat.toFixed(4)},{' '}
                      {preset.lon.toFixed(4)}
                    </div>
                    <p className="text-xs leading-relaxed text-ink-2">
                      {localized?.summary ?? preset.summary}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-line bg-ground py-4">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-ink-3">
          <span>{t.footer.left}</span>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/impressum"
              onClick={(e) => {
                e.preventDefault();
                onNavigateLegal('/impressum');
              }}
              className="hover:text-ink transition-colors duration-200 ease-out"
            >
              {t.footer.imprint}
            </a>
            <a
              href="/datenschutz"
              onClick={(e) => {
                e.preventDefault();
                onNavigateLegal('/datenschutz');
              }}
              className="hover:text-ink transition-colors duration-200 ease-out"
            >
              {t.footer.privacy}
            </a>
            <a
              href="/cookies"
              onClick={(e) => {
                e.preventDefault();
                onNavigateLegal('/cookies');
              }}
              className="hover:text-ink transition-colors duration-200 ease-out"
            >
              {t.footer.cookies}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
