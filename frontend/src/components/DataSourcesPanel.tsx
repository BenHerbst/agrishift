import { useEffect, useRef, type ReactNode } from 'react';
import { ExternalLink, Satellite, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { nasaPowerMonthlyUrl } from '../services/earthDataService';
import { GIBS_LAYERS, gibsGradient, type GibsLayerId } from '../services/nasaGibsService';
import type { ClimateForecastDataset, EarthSystemDataset, ForecastLoadStatus } from '../types/terrashift';

interface DataSourcesPanelProps {
  open: boolean;
  onClose: () => void;
  dataset: EarthSystemDataset | null;
  forecast: ClimateForecastDataset | null;
  forecastStatus: ForecastLoadStatus;
}

const COPY = {
  de: {
    title: 'Daten & APIs',
    intro: 'Jede Zahl in Terra Tuta stammt aus einer offenen Datenquelle. Hier steht, welche Anfrage für diesen Standort gestellt wurde.',
    close: 'Schließen',
    live: 'Live',
    fallback: 'Ersatzwerte',
    loading: 'Lädt',
    error: 'Nicht erreichbar',
    used: 'Genutzt für',
    params: 'Parameter',
    period: 'Zeitraum',
    openRequest: 'Anfrage öffnen',
    point: 'Messpunkt',
    powerMonthlyUse: 'Klimaverlauf, Zeitleiste, Trendstatistik (Mann-Kendall, Sen-Steigung)',
    powerDailyUse: 'Training des Prognose-Ensembles und der Agrar-Kennzahlen (Wärmesumme, Frost- und Hitzetage, Wasserbilanz)',
    powerDailyDerived: 'Daraus berechnet: Referenzverdunstung ET0 nach FAO-56 Penman-Monteith, Wärmesumme, Frost-, Hitze- und Regentage.',
    powerRegionalUse: 'Klima-Ebenen der Karte: Temperatur, Niederschlag und Bodenfeuchte im MERRA-2-Raster rund um den Standort',
    gibsUse: 'Satelliten-Ebenen der Karte, passend zum Zeitregler',
    otherTitle: 'Weitere Quellen',
    soil: 'Bodenprofil 0–30 cm: pH, organischer Kohlenstoff, Ton, Sand',
    indices: 'Klima-Indizes als Prognose-Treiber',
    places: 'Ortssuche',
    basemap: 'Kartengrundlage',
    noForecastYet: 'Wird geladen, sobald die Prognose für diesen Standort fertig ist.',
    era5: 'Für diesen Standort liegen ERA5-Land-Daten vor, sie haben Vorrang vor NASA POWER.',
    samples: (n: number) => `${n} Anfragen, je eine pro MERRA-2-Zelle im Feld`,
  },
  en: {
    title: 'Data & APIs',
    intro: 'Every number in Terra Tuta comes from an open data source. This lists the requests made for this site.',
    close: 'Close',
    live: 'Live',
    fallback: 'Estimated',
    loading: 'Loading',
    error: 'Unavailable',
    used: 'Used for',
    params: 'Parameters',
    period: 'Period',
    openRequest: 'Open request',
    point: 'Point',
    powerMonthlyUse: 'Climate history, timeline, trend statistics (Mann-Kendall, Sen slope)',
    powerDailyUse: 'Training the forecast ensemble and the farming indicators (growing degree days, frost and heat days, water balance)',
    powerDailyDerived: 'Derived from it: FAO-56 Penman-Monteith reference evapotranspiration, growing degree days, frost, heat and rain days.',
    powerRegionalUse: 'Map climate layers: temperature, precipitation and soil moisture on the MERRA-2 grid around the site',
    gibsUse: 'Map satellite layers, following the timeline',
    otherTitle: 'Other sources',
    soil: 'Topsoil profile 0–30 cm: pH, organic carbon, clay, sand',
    indices: 'Climate indices as forecast drivers',
    places: 'Place search',
    basemap: 'Base map',
    noForecastYet: 'Shown once the forecast for this site has loaded.',
    era5: 'ERA5-Land data is available for this site and takes precedence over NASA POWER.',
    samples: (n: number) => `${n} requests, one per MERRA-2 cell in the field`,
  },
};

const MONTHLY_PARAMS: Array<[string, { de: string; en: string }, string]> = [
  ['T2M', { de: 'Lufttemperatur in 2 m', en: 'Air temperature at 2 m' }, '°C'],
  ['PRECTOTCORR', { de: 'Niederschlag, bias-korrigiert', en: 'Precipitation, bias-corrected' }, 'mm/d'],
  ['GWETROOT', { de: 'Bodenfeuchte im Wurzelraum', en: 'Root-zone soil wetness' }, '0–1'],
  ['EVLAND', { de: 'Verdunstung über Land', en: 'Evaporation over land' }, 'mm/d'],
];
const DAILY_PARAMS = ['T2M', 'T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN', 'RH2M', 'WS2M', 'WS10M_MAX', 'PS', 'GWETTOP', 'GWETROOT'];

const code = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' };

function Status({ kind, label }: { kind: 'ok' | 'warn' | 'busy'; label: string }) {
  const tone = kind === 'ok' ? 'bg-crop/12 text-crop' : kind === 'warn' ? 'bg-warn/12 text-warn' : 'bg-raised text-ink-2';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${kind === 'ok' ? 'bg-crop' : kind === 'warn' ? 'bg-warn' : 'bg-ink-3 animate-pulse'}`} />
      {label}
    </span>
  );
}

function Source({
  name,
  endpoint,
  status,
  children,
}: {
  name: string;
  endpoint: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{name}</h3>
          <p className="mt-0.5 truncate text-[11px] text-ink-3" style={code}>
            {endpoint}
          </p>
        </div>
        {status}
      </div>
      <div className="mt-3 space-y-2.5 text-xs leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export function DataSourcesPanel({ open, onClose, dataset, forecast, forecastStatus }: DataSourcesPanelProps) {
  const { lang } = useI18n();
  const c = COPY[lang];
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const points = dataset?.powerPoints ?? (dataset ? [{ lat: dataset.lat, lon: dataset.lon }] : []);
  const powerStatus = !dataset ? (
    <Status kind="busy" label={c.loading} />
  ) : dataset.powerSource === 'live' ? (
    <Status kind="ok" label={`${c.live} · ${dataset.powerLatencyMs} ms`} />
  ) : (
    <Status kind="warn" label={c.fallback} />
  );
  const sources = forecast?.sources;
  const dailyFromPower = !sources || sources.historySource === 'nasa_power';
  const forecastBadge =
    forecastStatus === 'ready' ? (
      <Status kind="ok" label={c.live} />
    ) : forecastStatus === 'error' ? (
      <Status kind="warn" label={c.error} />
    ) : (
      <Status kind="busy" label={c.loading} />
    );
  const fmtMonth = (d: string) =>
    new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="data-sources-title">
      <button type="button" aria-label={c.close} onClick={onClose} className="absolute inset-0 bg-ink/30 backdrop-blur-[2px] cursor-default" />
      <div className="absolute inset-y-0 right-0 flex w-[min(36rem,100vw)] flex-col border-l border-line bg-ground shadow-[0_0_48px_rgba(28,38,31,0.25)] sources-panel-enter">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-panel px-5 py-4">
          <div>
            <h2 id="data-sources-title" className="flex items-center gap-2 text-lg font-bold text-ink">
              <Satellite className="h-5 w-5 text-crop" aria-hidden="true" />
              {c.title}
            </h2>
            <p className="mt-1 max-w-[60ch] text-xs leading-relaxed text-ink-2">{c.intro}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={c.close}
            className="rounded-md p-1.5 text-ink-2 hover:bg-raised hover:text-ink cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <Source name="NASA POWER · Monthly Point API" endpoint="power.larc.nasa.gov/api/temporal/monthly/point" status={powerStatus}>
            <p>
              <span className="font-semibold text-ink">{c.used}:</span> {c.powerMonthlyUse}
            </p>
            <table className="w-full text-left">
              <tbody>
                {MONTHLY_PARAMS.map(([p, label, unit]) => (
                  <tr key={p} className="border-t border-line first:border-t-0">
                    <td className="py-1 pr-3 font-semibold text-ink" style={code}>{p}</td>
                    <td className="py-1 pr-3">{label[lang]}</td>
                    <td className="py-1 text-right tabular-nums text-ink-3">{unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tabular-nums">
              community=<span className="text-ink" style={code}>AG</span> · {c.period} 1990–2025 · MERRA-2
              {points.length > 1 && <> · {c.samples(points.length)}</>}
            </p>
            <div className="flex flex-wrap gap-2">
              {points.map((pt, i) => (
                <a
                  key={`${pt.lat},${pt.lon}`}
                  href={nasaPowerMonthlyUrl(pt.lat, pt.lon)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink hover:border-crop hover:text-crop"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  {c.openRequest}
                  {points.length > 1 ? ` · ${c.point} ${i + 1}` : ''}
                </a>
              ))}
            </div>
          </Source>

          <Source name="NASA POWER · Daily Point API" endpoint="power.larc.nasa.gov/api/temporal/daily/point" status={forecastBadge}>
            <p>
              <span className="font-semibold text-ink">{c.used}:</span> {c.powerDailyUse}
            </p>
            {dailyFromPower ? (
              <>
                <div className="flex flex-wrap gap-1">
                  {DAILY_PARAMS.map((p) => (
                    <span key={p} className="rounded bg-raised px-1.5 py-0.5 text-[11px] text-ink" style={code}>
                      {p}
                    </span>
                  ))}
                </div>
                <p>{c.powerDailyDerived}</p>
                <p className="tabular-nums">
                  {c.period}: {sources?.historyPeriod ?? c.noForecastYet} · MERRA-2 / CERES
                </p>
              </>
            ) : (
              <p>{c.era5}</p>
            )}
          </Source>

          <Source name="NASA POWER · Monthly Regional API" endpoint="power.larc.nasa.gov/api/temporal/monthly/regional">
            <p>
              <span className="font-semibold text-ink">{c.used}:</span> {c.powerRegionalUse}
            </p>
            <p className="tabular-nums">
              T2M · PRECTOTCORR · GWETROOT · 0,5° × 0,625° · 1990–2025
            </p>
          </Source>

          <Source name="NASA GIBS · WMTS" endpoint="gibs.earthdata.nasa.gov/wmts/epsg3857/best" status={<Status kind="ok" label="EOSDIS" />}>
            <p>
              <span className="font-semibold text-ink">{c.used}:</span> {c.gibsUse}
            </p>
            <ul className="space-y-2">
              {(Object.keys(GIBS_LAYERS) as GibsLayerId[]).map((id) => {
                const spec = GIBS_LAYERS[id];
                return (
                  <li key={id} className="flex items-center gap-3">
                    <span className="h-3 w-10 shrink-0 rounded-sm ring-1 ring-black/10" style={{ background: gibsGradient(spec) }} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{spec.product}</span>
                      <span className="block truncate text-[11px] text-ink-3 tabular-nums">
                        <span style={code}>{spec.layer}</span> · {spec.resolution} · {fmtMonth(spec.first)} – {fmtMonth(spec.last)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Source>

          <h3 className="pt-2 text-xs font-semibold text-ink-2">{c.otherTitle}</h3>
          <div className="divide-y divide-line rounded-lg border border-line bg-panel text-xs text-ink-2">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span>
                <span className="font-semibold text-ink">ISRIC SoilGrids 2.0</span> · {c.soil}
              </span>
              {dataset &&
                (dataset.soil.source === 'live' ? (
                  <Status kind="ok" label={c.live} />
                ) : (
                  <Status kind="warn" label={c.fallback} />
                ))}
            </div>
            <div className="px-4 py-2.5">
              <span className="font-semibold text-ink">NOAA CPC / NCEI</span> · {c.indices}
              {sources?.climateIndices && (
                <span className="tabular-nums"> ({Object.entries(sources.climateIndices).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ')})</span>
              )}
            </div>
            <div className="px-4 py-2.5">
              <span className="font-semibold text-ink">OpenStreetMap · Photon, Nominatim</span> · {c.places}
            </div>
            <div className="px-4 py-2.5">
              <span className="font-semibold text-ink">Mapbox · Esri World Imagery</span> · {c.basemap}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
