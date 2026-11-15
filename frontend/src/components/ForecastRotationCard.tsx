import { Loader2, Sprout } from 'lucide-react';
import type { RotationPlan } from '../services/climateForecastService';

type Lang = 'de' | 'en';

const CROP_NAMES: Record<string, { de: string; en: string }> = {
  winter_wheat: { de: 'Winterweizen', en: 'Winter wheat' },
  winter_barley: { de: 'Wintergerste', en: 'Winter barley' },
  spring_barley: { de: 'Sommergerste', en: 'Spring barley' },
  oats: { de: 'Hafer', en: 'Oats' },
  maize: { de: 'Mais', en: 'Maize' },
  winter_rapeseed: { de: 'Winterraps', en: 'Winter rapeseed' },
  sunflower: { de: 'Sonnenblume', en: 'Sunflower' },
  potato: { de: 'Kartoffel', en: 'Potato' },
  sugar_beet: { de: 'Zuckerrübe', en: 'Sugar beet' },
  field_pea: { de: 'Körnererbse', en: 'Field pea' },
  faba_bean: { de: 'Ackerbohne', en: 'Faba bean' },
  soybean: { de: 'Sojabohne', en: 'Soybean' },
  clover_grass: { de: 'Kleegras', en: 'Clover grass' },
};

export const cropName = (id: string, lang: Lang) =>
  CROP_NAMES[id]?.[lang] ?? id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// shortcut: German wording for the backend's English reason templates (app/rotation.py); a reason
// that matches none of them is shown in English. Move to reason codes if more languages are added.
const REASONS_DE: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Too cool: (\S+) of (\S+) °C·days needed \((.+)\)$/, (m) => `Zu kühl: ${m[1]} von ${m[2]} nötigen °C·Tagen (${m[3]})`],
  [/^Rain-fed water shortfall (\S+) mm \((.+)\)$/, (m) => `Wasserdefizit ohne Bewässerung: ${m[1]} mm (${m[2]})`],
  [/^(\S+) heat days \((.+)\)$/, (m) => `${m[1]} Hitzetage (${m[2]})`],
  [/^(\S+) frost days after sowing \((.+)\)$/, (m) => `${m[1]} Frosttage nach der Aussaat (${m[2]})`],
  [
    /^Humid and wet \((\S+) % humidity, (\S+) wet days\/month\): fungal disease pressure \((.+)\)$/,
    (m) => `Feucht und nass (${m[1]} % Luftfeuchte, ${m[2]} Regentage/Monat): Pilzdruck (${m[3]})`,
  ],
  [
    /^Soil pH (\S+) outside (\S+)(, lime first)? \((.+)\)$/,
    (m) => `Boden-pH ${m[1]} außerhalb ${m[2]}${m[3] ? ', vorher kalken' : ''} (${m[4]})`,
  ],
  [/^Uses the nitrogen left by (\w+) \((.+)\)$/, (m) => `Nutzt den Stickstoff der Vorfrucht ${cropName(m[1], 'de')} (${m[2]})`],
  [/^Fusarium \/ mycotoxin risk from the maize residue \((.+)\)$/, (m) => `Fusarium- und Mykotoxinrisiko durch Maisreste (${m[1]})`],
  [/^Pollution caution: (.+)$/, (m) => `Vorsicht, Schadstoffquelle in der Nähe: ${m[1]}`],
  [/^Climate and soil suit this crop well$/, () => 'Klima und Boden passen gut'],
  [/^No crop fits – sow a cover crop and rest the field$/, () => 'Keine Kultur passt: Zwischenfrucht säen und Fläche ruhen lassen'],
];

function reasonText(reason: string, lang: Lang): string {
  const pretty = reason.replace(/\buses the nitrogen left by (\w+)/i, (all, id) => all.replace(id, cropName(id, 'en')));
  if (lang === 'en') return pretty;
  for (const [re, fmt] of REASONS_DE) {
    const m = reason.match(re);
    if (m) return fmt(m);
  }
  return pretty;
}

const COPY = {
  de: {
    title: 'Empfehlung aus der Prognose',
    subtitle:
      'Je Jahr die Kultur mit der besten Eignung für die vorhergesagte Wärme, das Wasser, Hitze, Frost und Krankheitsdruck, unter Einhaltung der Fruchtfolgeregeln.',
    loading: 'Wird aus der Prognose berechnet…',
    waiting: 'Erscheint, sobald die Prognose für diesen Standort fertig ist.',
    error: 'Die Empfehlung ist gerade nicht verfügbar.',
    suitability: 'Eignung',
    alternatives: 'Alternativen',
    soil: (ph?: number, taw?: number) =>
      [ph !== undefined ? `Boden-pH ${ph.toFixed(1)}` : null, taw !== undefined ? `nutzbares Bodenwasser ${Math.round(taw)} mm` : null]
        .filter(Boolean)
        .join(' · '),
    pollutionSafe: 'Schadstoff-Check: alle Kulturgruppen unbedenklich',
    pollutionFlagged: (n: number) => `Schadstoff-Check: ${n} Kulturgruppe${n === 1 ? '' : 'n'} mit Einschränkung`,
  },
  en: {
    title: 'Recommendation from the forecast',
    subtitle:
      'For each year, the crop best suited to the forecast warmth, water, heat, frost and disease pressure, following crop rotation rules.',
    loading: 'Calculating from the forecast…',
    waiting: 'Appears once the forecast for this site is ready.',
    error: 'The recommendation is not available right now.',
    suitability: 'Suitability',
    alternatives: 'Alternatives',
    soil: (ph?: number, taw?: number) =>
      [ph !== undefined ? `Soil pH ${ph.toFixed(1)}` : null, taw !== undefined ? `plant-available water ${Math.round(taw)} mm` : null]
        .filter(Boolean)
        .join(' · '),
    pollutionSafe: 'Pollution check: all crop groups safe',
    pollutionFlagged: (n: number) => `Pollution check: ${n} crop group${n === 1 ? '' : 's'} restricted`,
  },
};

interface ForecastRotationCardProps {
  plan: RotationPlan | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  lang: Lang;
}

export function ForecastRotationCard({ plan, status, lang }: ForecastRotationCardProps) {
  const c = COPY[lang];
  const pollution = plan?.pollution && !('error' in plan.pollution) ? (plan.pollution as Record<string, string>) : null;
  const flagged = pollution ? Object.values(pollution).filter((v) => v !== 'safe').length : 0;

  return (
    <section className="rounded-md border border-crop/35 bg-panel">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <Sprout className="mt-0.5 h-4 w-4 shrink-0 text-crop" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{c.title}</h3>
          <p className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-ink-2">{c.subtitle}</p>
        </div>
      </div>

      {status !== 'ready' || !plan ? (
        <p className="flex items-center gap-2 px-4 py-5 text-xs text-ink-2">
          {status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {status === 'loading' ? c.loading : status === 'error' ? c.error : c.waiting}
        </p>
      ) : (
        <>
          <ol className="grid grid-cols-1 gap-px bg-line sm:grid-cols-3">
            {plan.plan.map((y) => (
              <li key={y.year} className="flex flex-col gap-2 bg-panel p-4">
                <span className="text-xs font-semibold tabular-nums text-ink-3">{y.year}</span>
                <span className="text-base font-bold leading-tight text-ink" style={{ fontStretch: '112%' }}>
                  {y.crop ? cropName(y.crop, lang) : '—'}
                </span>
                {y.score !== null && (
                  <div>
                    <div className="flex items-baseline justify-between text-[11px] text-ink-3">
                      <span>{c.suitability}</span>
                      <span className="font-semibold tabular-nums text-ink">{y.score}/100</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
                      <div
                        className={`h-full rounded-full ${y.score >= 70 ? 'bg-crop' : y.score >= 50 ? 'bg-rapeseed' : 'bg-warn'}`}
                        style={{ width: `${y.score}%` }}
                      />
                    </div>
                  </div>
                )}
                <ul className="space-y-1 text-xs leading-snug text-ink-2">
                  {y.reasons.slice(0, 3).map((r) => (
                    <li key={r} className="flex gap-1.5">
                      <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                      <span>{reasonText(r, lang)}</span>
                    </li>
                  ))}
                </ul>
                {y.alternatives.length > 0 && (
                  <p className="mt-auto pt-1 text-[11px] text-ink-3">
                    {c.alternatives}:{' '}
                    {y.alternatives.map((a) => `${cropName(a.crop, lang)} ${a.score}`).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-3">
            {[
              c.soil(plan.soil.ph, plan.soil.total_available_water_mm),
              pollution ? (flagged === 0 ? c.pollutionSafe : c.pollutionFlagged(flagged)) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </>
      )}
    </section>
  );
}
