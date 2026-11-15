import { Fragment, useEffect, useState } from 'react';
import { Loader2, Scale } from 'lucide-react';
import {
  ROTATION_DIMENSIONS,
  fetchRotationComparison,
  type RotationComparison,
  type RotationDimension,
  type RotationScenario,
} from '../services/climateForecastService';
import { cropName } from './ForecastRotationCard';

type Lang = 'de' | 'en';

const COPY = {
  de: {
    title: 'Fruchtfolgen im Vergleich',
    subtitle:
      'Die Empfehlung und die beste Fruchtfolge je Ziel, bewertet von 0 bis 100 (höher ist besser). Zeile antippen oder darüberfahren zeigt die Zahlen hinter den Noten.',
    loading: 'Fruchtfolgen werden verglichen…',
    error: 'Der Vergleich ist gerade nicht verfügbar.',
    scenario: 'Fruchtfolge',
    total: 'Gesamt',
    dimensions: {
      climate_fit: 'Klima',
      nutrient_cycling: 'Nährstoffe',
      organic_matter: 'Humus',
      erosion: 'Erosion',
      pest_cycle: 'Schädlinge',
      water_use: 'Wasser',
      forage: 'Futter',
      market: 'Markt',
    } as Record<RotationDimension, string>,
    labels: {
      recommended_plan: 'Empfehlung',
      best_climate_fit: 'Beste Klimaeignung',
      soil_building: 'Bodenaufbau',
      water_saving: 'Wasser sparen',
      erosion_control: 'Erosionsschutz',
      forage: 'Futterertrag',
      market: 'Markt',
      balanced: 'Ausgewogen',
    } as Record<string, string>,
    metric: {
      climate_fit: (s: RotationScenario) => `Mittlere Eignung der Kulturen für die Prognose: ${s.scores.climate_fit}`,
      nutrient_cycling: (s: RotationScenario) =>
        `Zu kaufender Mineral-N: ${s.metrics.mineral_n_to_buy_kg_per_ha_year} kg/ha·Jahr, von Vorfrüchten genutzt: ${s.metrics.n_credit_reused_kg_per_ha} kg/ha`,
      organic_matter: (s: RotationScenario) => `Humusbilanz: ${s.metrics.humus_balance_kg_c_per_ha_year} kg C/ha·Jahr`,
      erosion: (s: RotationScenario) => `Erosionsrisiko-Index: ${s.metrics.erosion_risk_index} (Bodenbedeckung, Regen, Bodenart)`,
      pest_cycle: (s: RotationScenario) =>
        s.rule_violations.length ? `Verstöße gegen Fruchtfolgeregeln: ${s.rule_violations.length}` : 'Fruchtfolgeregeln eingehalten',
      water_use: (s: RotationScenario) =>
        `Wasserbedarf ${s.metrics.water_demand_mm_per_year} mm, ungedeckt ${s.metrics.water_shortfall_mm_per_year} mm pro Jahr`,
      forage: (s: RotationScenario) => `Futterwert-Index: ${s.metrics.feed_value}`,
      market: (s: RotationScenario) => `Deckungsbeitrags-Index (Richtwert): ${s.metrics.indicative_margin_index}`,
    },
    unsafe: 'Schadstoffbelastung am Standort',
    note: 'Richtwerte für Mitteleuropa: Humus-, N-, Bodenbedeckungs- und Futterwerte je Kultur sowie der Markt-Index (relative Marge, Preisrisiko, Vertragsbindung) sind Schätzungen, keine aktuellen Preise.',
  },
  en: {
    title: 'Rotation scenarios compared',
    subtitle:
      'The recommendation and the best rotation for each goal, scored 0 to 100 (higher is better). Tap or hover a row to see the figures behind the scores.',
    loading: 'Comparing rotations…',
    error: 'The comparison is not available right now.',
    scenario: 'Rotation',
    total: 'Overall',
    dimensions: {
      climate_fit: 'Climate',
      nutrient_cycling: 'Nutrients',
      organic_matter: 'Humus',
      erosion: 'Erosion',
      pest_cycle: 'Pests',
      water_use: 'Water',
      forage: 'Forage',
      market: 'Market',
    } as Record<RotationDimension, string>,
    labels: {
      recommended_plan: 'Recommended',
      best_climate_fit: 'Best climate fit',
      soil_building: 'Soil building',
      water_saving: 'Water saving',
      erosion_control: 'Erosion control',
      forage: 'Forage yield',
      market: 'Market',
      balanced: 'Balanced',
    } as Record<string, string>,
    metric: {
      climate_fit: (s: RotationScenario) => `Mean suitability of the crops for the forecast: ${s.scores.climate_fit}`,
      nutrient_cycling: (s: RotationScenario) =>
        `Mineral N to buy: ${s.metrics.mineral_n_to_buy_kg_per_ha_year} kg/ha·year, reused from previous crops: ${s.metrics.n_credit_reused_kg_per_ha} kg/ha`,
      organic_matter: (s: RotationScenario) => `Humus balance: ${s.metrics.humus_balance_kg_c_per_ha_year} kg C/ha·year`,
      erosion: (s: RotationScenario) => `Erosion risk index: ${s.metrics.erosion_risk_index} (soil cover, rainfall, soil texture)`,
      pest_cycle: (s: RotationScenario) =>
        s.rule_violations.length ? `Rotation rule violations: ${s.rule_violations.length}` : 'Rotation rules kept',
      water_use: (s: RotationScenario) =>
        `Water demand ${s.metrics.water_demand_mm_per_year} mm, unmet ${s.metrics.water_shortfall_mm_per_year} mm per year`,
      forage: (s: RotationScenario) => `Feed value index: ${s.metrics.feed_value}`,
      market: (s: RotationScenario) => `Indicative margin index: ${s.metrics.indicative_margin_index}`,
    },
    unsafe: 'Pollution at this site',
    note: 'Rule-of-thumb values for temperate Europe: humus, nitrogen, soil cover and feed values per crop and the market index (relative margin, price risk, contract dependence) are estimates, not live prices.',
  },
};

const cellTone = (score: number) => (score >= 70 ? 'bg-crop/25' : score >= 45 ? 'bg-rapeseed/25' : 'bg-warn/25');

interface RotationCompareCardProps {
  lat: number;
  lon: number;
  /** wait until the forecast behind the comparison is ready (then it is cached and fast) */
  enabled: boolean;
  lang: Lang;
}

export function RotationCompareCard({ lat, lon, enabled, lang }: RotationCompareCardProps) {
  const c = COPY[lang];
  const [data, setData] = useState<RotationComparison | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    setData(null);
    setOpenIndex(null);
    if (!enabled) {
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    fetchRotationComparison(lat, lon, controller.signal)
      .then((result) => {
        setData(result);
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [enabled, lat, lon]);

  if (status === 'idle') return null;

  return (
    <section className="rounded-md border border-line bg-panel">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-crop" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{c.title}</h3>
          <p className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-ink-2">{c.subtitle}</p>
        </div>
      </div>

      {status !== 'ready' || !data ? (
        <p className="flex items-center gap-2 px-4 py-5 text-xs text-ink-2">
          {status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {status === 'loading' ? c.loading : c.error}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead>
                <tr className="text-left text-[11px] text-ink-3">
                  <th className="px-3 py-2 font-medium">{c.scenario}</th>
                  {ROTATION_DIMENSIONS.map((d) => (
                    <th key={d} className="px-1.5 py-2 text-center font-medium">
                      {c.dimensions[d]}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center font-semibold text-ink">{c.total}</th>
                </tr>
              </thead>
              <tbody>
                {data.scenarios.map((s, i) => {
                  const labels = s.labels.map((l) => c.labels[l] ?? l).join(' · ');
                  const open = openIndex === i;
                  return (
                    <Fragment key={s.rotation.map((r) => r.crop).join('>')}>
                      <tr
                        className="cursor-pointer border-t border-line align-top hover:bg-raised"
                        onClick={() => setOpenIndex(open ? null : i)}
                        title={s.rotation.map((r) => `${r.year}: ${cropName(r.crop, lang)}`).join('\n')}
                      >
                        <td className="px-3 py-2">
                          <div className="font-semibold text-ink">{labels}</div>
                          <div className="mt-0.5 text-[11px] text-ink-3">
                            {s.rotation.map((r) => cropName(r.crop, lang)).join(' → ')}
                          </div>
                        </td>
                        {ROTATION_DIMENSIONS.map((d) => (
                          <td key={d} className="px-1 py-1.5 text-center">
                            <span
                              className={`inline-block min-w-[2.25rem] rounded px-1.5 py-1 tabular-nums text-ink ${cellTone(s.scores[d])} ${
                                s.best_at.includes(d) ? 'font-bold ring-1 ring-ink-3' : ''
                              }`}
                              title={c.metric[d](s)}
                            >
                              {s.scores[d]}
                            </span>
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center font-bold tabular-nums text-ink">{s.composite}</td>
                      </tr>
                      {open && (
                        <tr className="bg-raised/60">
                          <td colSpan={ROTATION_DIMENSIONS.length + 2} className="px-3 py-2.5">
                            <ul className="grid gap-x-6 gap-y-1 text-[11px] leading-snug text-ink-2 sm:grid-cols-2">
                              {ROTATION_DIMENSIONS.map((d) => (
                                <li key={d}>
                                  <span className="font-semibold text-ink">{c.dimensions[d]}:</span> {c.metric[d](s)}
                                </li>
                              ))}
                            </ul>
                            {s.rule_violations.length > 0 && (
                              <p className="mt-1.5 text-[11px] text-warn">{s.rule_violations.join(' · ')}</p>
                            )}
                            {s.excluded_for_pollution.length > 0 && (
                              <p className="mt-1.5 text-[11px] text-warn">
                                {c.unsafe}: {s.excluded_for_pollution.join(' · ')}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-3">{c.note}</p>
        </>
      )}
    </section>
  );
}
