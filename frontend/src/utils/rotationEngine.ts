import { MONTH_SHORT_BY_LANG, type AppLanguage } from '../i18n/translations';
import type {
  BaselineCropId,
  ClimateStressFlag,
  ClimateVariable,
  CropCalendarMonthCell,
  CropCalendarYear,
  EarthSystemDataset,
  FarmerPriorities,
  RadarMetricPoint,
  RotationScenario,
  TrendStatistics,
} from '../types/terrashift';

export const BASELINE_CROP_OPTIONS: Array<{
  id: BaselineCropId;
  label: string;
  regionHint: string;
}> = [
  {
    id: 'wheat_maize',
    label: 'Continuous Winter Wheat – Silage Maize',
    regionHint: 'Temperate European / Loess Plains',
  },
  {
    id: 'soy_corn',
    label: 'Monoculture Soy / Corn Rotation',
    regionHint: 'Continental Prairie Belts',
  },
  {
    id: 'irrigated_alfalfa',
    label: 'Irrigated Alfalfa – Annual Row Crop',
    regionHint: 'Semi-Arid Irrigated Basins',
  },
  {
    id: 'rainfed_olive_cereal',
    label: 'Rainfed Olive / Bare-Fallow Cereal',
    regionHint: 'Mediterranean Dryland Hills',
  },
];

function clampScore(val: number): number {
  return Math.round(Math.min(98, Math.max(18, val)));
}

function formatPValue(p: number): string {
  return p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`;
}

function stressForMonth(
  month: number,
  peakHeatMonths: number[],
  moistureDeficitMonths: number[]
): ClimateStressFlag {
  const isHeat = peakHeatMonths.includes(month);
  const isDry = moistureDeficitMonths.includes(month);
  if (isDry && !isHeat) return 'water_stress';
  if (isHeat) return 'heat_stress';
  return 'optimal';
}

interface MonthTemplate {
  cropName: string;
  coverStatus: 'cash' | 'cover' | 'bare_risk';
  note: string;
}

function buildYearCells(
  templates: MonthTemplate[],
  peakHeatMonths: number[],
  moistureDeficitMonths: number[],
  monthsShort: string[]
): CropCalendarMonthCell[] {
  return templates.map((tpl, idx) => {
    const month = idx + 1;
    return {
      month,
      monthLabel: monthsShort[idx],
      cropName: tpl.cropName,
      coverStatus: tpl.coverStatus,
      stressFlag: stressForMonth(month, peakHeatMonths, moistureDeficitMonths),
      note: tpl.note,
    };
  });
}

function repeatThreeYears(
  year1: { title: string; months: MonthTemplate[] },
  year2: { title: string; months: MonthTemplate[] },
  year3: { title: string; months: MonthTemplate[] },
  peakHeatMonths: number[],
  moistureDeficitMonths: number[],
  lang: AppLanguage
): CropCalendarYear[] {
  const monthsShort = MONTH_SHORT_BY_LANG[lang];
  const yrWord = lang === 'de' ? 'Jahr' : 'Year';
  return [
    {
      yearNumber: 1,
      yearLabel: `${yrWord} 1`,
      sequenceTitle: year1.title,
      months: buildYearCells(year1.months, peakHeatMonths, moistureDeficitMonths, monthsShort),
    },
    {
      yearNumber: 2,
      yearLabel: `${yrWord} 2`,
      sequenceTitle: year2.title,
      months: buildYearCells(year2.months, peakHeatMonths, moistureDeficitMonths, monthsShort),
    },
    {
      yearNumber: 3,
      yearLabel: `${yrWord} 3`,
      sequenceTitle: year3.title,
      months: buildYearCells(year3.months, peakHeatMonths, moistureDeficitMonths, monthsShort),
    },
  ];
}

function fillMonths(
  ranges: Array<{
    months: number[];
    cropName: string;
    coverStatus: 'cash' | 'cover' | 'bare_risk';
    note: string;
  }>,
  lang: AppLanguage
): MonthTemplate[] {
  const arr: MonthTemplate[] = Array.from({ length: 12 }, () => ({
    cropName: lang === 'de' ? 'Brache' : 'Bare Fallow',
    coverStatus: 'bare_risk' as const,
    note:
      lang === 'de'
        ? 'Unbedeckter Oberboden anfällig für Wind- und Regenerosion'
        : 'Exposed topsoil vulnerable to wind/rain crusting',
  }));
  for (const r of ranges) {
    for (const m of r.months) {
      arr[m - 1] = {
        cropName: r.cropName,
        coverStatus: r.coverStatus,
        note: r.note,
      };
    }
  }
  return arr;
}

function buildBaselineCalendar(
  baselineCrop: BaselineCropId,
  peakHeat: number[],
  dryMonths: number[],
  lang: AppLanguage
): CropCalendarYear[] {
  const de = lang === 'de';

  if (baselineCrop === 'soy_corn') {
    const cornYear = {
      title: de ? 'Dauer-Körnermais + Winter-Stoppelbrache' : 'Continuous Grain Maize + Winter Bare Stubble',
      months: fillMonths(
        [
          {
            months: [1, 2, 3, 11, 12],
            cropName: de ? 'Stoppelbrache' : 'Bare Stubble',
            coverStatus: 'bare_risk',
            note: de
              ? 'Unbedeckte Ernterückstände erhöhen Frühjahrsabfluss & Nitratauswaschung'
              : 'Uncovered residue leaves soil exposed to spring runoff & nitrate leaching',
          },
          {
            months: [4, 5, 6, 7, 8, 9, 10],
            cropName: de ? 'Körnermais' : 'Grain Maize',
            coverStatus: 'cash',
            note: de
              ? 'Hoher Wasser- und Stickstoffbedarf während der Blüte im Hochsommer'
              : 'High mid-summer water & nitrogen demand during pollination',
          },
        ],
        lang
      ),
    };
    const soyYear = {
      title: de ? 'Monokultur Soja + Herbstbrache' : 'Monoculture Soybean + Bare Autumn Fallow',
      months: fillMonths(
        [
          {
            months: [1, 2, 3, 4, 10, 11, 12],
            cropName: de ? 'Schwarzbrache' : 'Bare Fallow',
            coverStatus: 'bare_risk',
            note: de
              ? '7 Monate unbedeckter Boden beschleunigen Humusabbau'
              : '7-month bare window accelerates organic carbon oxidation',
          },
          {
            months: [5, 6, 7, 8, 9],
            cropName: de ? 'Sojabohne' : 'Soybean',
            coverStatus: 'cash',
            note: de
              ? 'Hülsenfüllung empfindlich gegenüber Hitzespitzen im Juli–August'
              : 'Pod-fill sensitive to July–August heat spikes',
          },
        ],
        lang
      ),
    };
    return repeatThreeYears(cornYear, soyYear, cornYear, peakHeat, dryMonths, lang);
  }

  if (baselineCrop === 'irrigated_alfalfa') {
    const alfalfaYear = {
      title: de ? 'Bewässerte Luzerne (Hohe ET)' : 'High-ET Irrigated Alfalfa Stand',
      months: fillMonths(
        [
          {
            months: [1, 2, 12],
            cropName: de ? 'Winterruhe' : 'Dormant Crown',
            coverStatus: 'cover',
            note: de
              ? 'Mehrjähriger Bestand schützt den Boden vor Winterniederschlag'
              : 'Perennial crown shields soil from winter rain',
          },
          {
            months: [3, 4, 5, 6, 7, 8, 9, 10, 11],
            cropName: de ? 'Bewäss. Luzerne' : 'Irrigated Alfalfa',
            coverStatus: 'cash',
            note: de
              ? 'Hoher Bewässerungsbedarf während des sommerlichen Sättigungsdefizits'
              : 'Continuous multi-cut irrigation demand peaks during summer vapor deficit',
          },
        ],
        lang
      ),
    };
    const rowCropYear = {
      title: de ? 'Intensive Reihenkultur + Winterbrache' : 'Tilth-Intensive Annual Row Crop',
      months: fillMonths(
        [
          {
            months: [1, 2, 3, 10, 11, 12],
            cropName: de ? 'Offener Damm' : 'Bare Laser-Bed',
            coverStatus: 'bare_risk',
            note: de
              ? 'Bearbeitete Winterbeete anfällig für Verschlämmung und Winderosion'
              : 'Tilled winter beds vulnerable to crusting and wind erosion',
          },
          {
            months: [4, 5, 6, 7, 8, 9],
            cropName: de ? 'Reihenkultur' : 'Annual Row Crop',
            coverStatus: 'cash',
            note: de
              ? 'Starke Bewässerungsabhängigkeit in den heißesten Monaten'
              : 'Heavy irrigation dependency in peak heat months',
          },
        ],
        lang
      ),
    };
    return repeatThreeYears(alfalfaYear, alfalfaYear, rowCropYear, peakHeat, dryMonths, lang);
  }

  if (baselineCrop === 'rainfed_olive_cereal') {
    const cerealYear = {
      title: de ? 'Trockenfeldbau Hartweizen + Sommerbrache' : 'Tilled Dryland Durum + Summer Bare Fallow',
      months: fillMonths(
        [
          {
            months: [1, 2, 3, 4, 5],
            cropName: de ? 'Wintergetreide' : 'Rainfed Cereal',
            coverStatus: 'cash',
            note: de
              ? 'Kornfüllung konkurriert mit einsetzender Frühjahrstrockenheit'
              : 'Grain-fill competes with rapid spring soil drying',
          },
          {
            months: [6, 7, 8, 9, 10],
            cropName: de ? 'Gegrubb. Brache' : 'Tilled Bare Fallow',
            coverStatus: 'bare_risk',
            note: de
              ? 'Hohe Aufheizung und Flächenerosion bei Herbst-Starkregen'
              : 'Intense solar heating & autumn storm sheet erosion risk',
          },
          {
            months: [11, 12],
            cropName: de ? 'Frühes Getreide' : 'Early Cereal',
            coverStatus: 'cash',
            note: de
              ? 'Langsame Bestandesentwicklung während der Herbstregen'
              : 'Slow canopy establishment during autumn rains',
          },
        ],
        lang
      ),
    };
    return repeatThreeYears(cerealYear, cerealYear, cerealYear, peakHeat, dryMonths, lang);
  }

  // Default: Continuous Winter Wheat - Silage Maize
  const wheatYear = {
    title: de ? 'Winterweizen + Nachernte-Stoppelbrache' : 'Winter Wheat + Post-Harvest Bare Stubble',
    months: fillMonths(
      [
        {
          months: [1, 2, 3, 4, 5, 6, 7],
          cropName: de ? 'Winterweizen' : 'Winter Wheat',
          coverStatus: 'cash',
          note: de
            ? 'Abreifendes Getreide erfährt späten Frühjahrs-/Frühsommer-Hitzestress'
            : 'Maturing cereal faces late-spring / early-summer heat stress',
        },
        {
          months: [8, 9, 10],
          cropName: de ? 'Stoppelbrache' : 'Bare Stubble',
          coverStatus: 'bare_risk',
          note: de
            ? 'Unbedeckte Stoppeln erhöhen Verdunstung und Spätsommer-Abfluss'
            : 'Post-harvest bare fallow exposes topsoil to late-summer storms & evaporation',
        },
        {
          months: [11, 12],
          cropName: de ? 'Winterweizen' : 'Winter Wheat',
          coverStatus: 'cash',
          note: de ? 'Bestockungsphase vor dem Winter' : 'Early winter tillering establishment',
        },
      ],
      lang
    ),
  };
  const maizeYear = {
    title: de ? 'Silomais + Winter-Pflugfurche' : 'Silage Maize + Bare Winter Plough',
    months: fillMonths(
      [
        {
          months: [1, 2, 3, 10, 11, 12],
          cropName: de ? 'Offene Furche' : 'Bare Ploughed Soil',
          coverStatus: 'bare_risk',
          note: de
            ? '6 Monate unbedeckter Boden fördern Verschlämmung & N-Auswaschung'
            : '6-month bare window triggers structural slaking and N leaching',
        },
        {
          months: [4, 5, 6, 7, 8, 9],
          cropName: de ? 'Silomais' : 'Silage Maize',
          coverStatus: 'cash',
          note: de
            ? 'Maximaler Wasserbedarf zur Blüte trifft auf höchste Hitze & Trockenheit'
            : 'Peak water-demand silking overlaps highest heat & soil drying window',
        },
      ],
      lang
    ),
  };
  return repeatThreeYears(wheatYear, maizeYear, wheatYear, peakHeat, dryMonths, lang);
}

function buildHydroResilientCalendar(
  baselineCrop: BaselineCropId,
  peakHeat: number[],
  dryMonths: number[],
  lang: AppLanguage
): CropCalendarYear[] {
  const de = lang === 'de';
  const isWarmBasin = baselineCrop === 'irrigated_alfalfa' || baselineCrop === 'rainfed_olive_cereal';

  if (isWarmBasin) {
    const y1 = {
      title: de ? 'Trockentolerante Sorghumhirse + Wintergerste' : 'Drought-Hardy Grain Sorghum + Winter Barley Cover',
      months: fillMonths(
        [
          {
            months: [1, 2, 3],
            cropName: de ? 'Wintergerste-Zw.' : 'Winter Barley Cover',
            coverStatus: 'cover',
            note: de
              ? 'Speichert Winterniederschlag und beschattet den Oberboden'
              : 'Captures winter precipitation and shades early soil surface',
          },
          {
            months: [4, 5, 6, 7, 8, 9],
            cropName: de ? 'Körner-Sorghum' : 'Grain Sorghum',
            coverStatus: 'cash',
            note: de
              ? 'C4-Tiefwurzler toleriert Juli–August-Hitze mit ~32 % weniger Wasser'
              : 'C4 deep-root physiology tolerates peak July–August heat with ~32% less water',
          },
          {
            months: [10, 11, 12],
            cropName: de ? 'Grünroggen-Mulch' : 'Winter Rye Mulch',
            coverStatus: 'cover',
            note: de
              ? 'Lebende Mulchdecke verhindert Erosion bei Herbst-Starkregen'
              : 'Living mulch halts autumn cloudburst erosion',
          },
        ],
        lang
      ),
    };
    const y2 = {
      title: de ? 'Trocken-Kichererbse + Gewalzte Roggenauflage' : 'Dryland Chickpea + Rolled Rye Residue',
      months: fillMonths(
        [
          {
            months: [1, 2],
            cropName: de ? 'Grünroggen' : 'Winter Rye Cover',
            coverStatus: 'cover',
            note: de
              ? 'Stabilisiert Bodenporen vor der Frühjahrsaussaat'
              : 'Builds soil pore continuity before spring seeding',
          },
          {
            months: [3, 4, 5, 6, 7],
            cropName: de ? 'Kichererbse' : 'Desi Chickpea',
            coverStatus: 'cash',
            note: de
              ? 'Wassersparende Leguminose reift vor dem August-Tiefststand ab'
              : 'Low-ET pulse crop matures ahead of peak August water deficit',
          },
          {
            months: [8, 9],
            cropName: de ? 'Stroh-Mulchdecke' : 'Residue Mulch',
            coverStatus: 'cover',
            note: de
              ? 'Direktsaat-Mulch senkt Bodenverdunstung um bis zu 40 %'
              : 'No-till straw armor reduces bare-soil evaporation by up to 40%',
          },
          {
            months: [10, 11, 12],
            cropName: de ? 'Triticale-Zw.' : 'Triticale Cover',
            coverStatus: 'cover',
            note: de
              ? 'Bindet Restnitrat und verankert den Oberboden'
              : 'Scavenges residual nitrate and anchors topsoil',
          },
        ],
        lang
      ),
    };
    const y3 = {
      title: de ? 'Trockengerste + Sommer-Perlhirse' : 'Winter Drought Barley + Summer Millet Catch',
      months: fillMonths(
        [
          {
            months: [1, 2, 3, 4, 5],
            cropName: de ? 'Trockengerste' : 'Drought Barley',
            coverStatus: 'cash',
            note: de
              ? 'Frühreife umgeht extreme Spätsommerhitze'
              : 'Early maturity escapes extreme late-summer heat',
          },
          {
            months: [6, 7, 8, 9],
            cropName: de ? 'Perlhirse-Deckfrucht' : 'Pearl Millet Cover',
            coverStatus: 'cover',
            note: de
              ? 'Hitzetolerante Begrünung erhält Bodenleben ohne Bewässerung'
              : 'Heat-tolerant cover sustains root exudates without irrigation',
          },
          {
            months: [10, 11, 12],
            cropName: de ? 'Wicke + Roggen' : 'Winter Vetch + Rye',
            coverStatus: 'cover',
            note: de
              ? 'Stellt Winterbedeckung und Stickstoffversorgung wieder her'
              : 'Restores winter ground cover and nitrogen',
          },
        ],
        lang
      ),
    };
    return repeatThreeYears(y1, y2, y3, peakHeat, dryMonths, lang);
  }

  const y1 = {
    title: de ? 'Grünroggen → Trockentolerante Sorghumhirse' : 'Winter Rye Cover → Drought-Tolerant Grain Sorghum',
    months: fillMonths(
      [
        {
          months: [1, 2, 3, 4],
          cropName: de ? 'Grünroggen-Zw.' : 'Winter Rye Cover',
          coverStatus: 'cover',
          note: de
            ? 'Aktive Winterwurzeln sichern Niederschlag und stoppen Erosion'
            : 'Active winter roots absorb excess rain and block spring erosion',
        },
        {
          months: [5, 6, 7, 8, 9],
          cropName: de ? 'Körner-Sorghum' : 'Grain Sorghum',
          coverStatus: 'cash',
          note: de
            ? 'Ersetzt wasserintensiven Mais im trockenen Juli–August-Fenster'
            : 'Replaces high-water maize during peak July–August moisture deficit',
        },
        {
          months: [10, 11, 12],
          cropName: de ? 'Winterweizen' : 'Winter Wheat',
          coverStatus: 'cash',
          note: de
            ? 'Mulchsaat direkt in Sorghum-Rückstände für durchgehende Deckung'
            : 'Direct-drilled into sorghum residue for continuous soil armor',
        },
      ],
      lang
    ),
  };
  const y2 = {
    title: de ? 'Winterweizen → Kichererbse / Phacelia-Mix' : 'Winter Wheat → Chickpea / Mustard Catch Mix',
    months: fillMonths(
      [
        {
          months: [1, 2, 3, 4, 5, 6, 7],
          cropName: de ? 'Winterweizen' : 'Winter Wheat',
          coverStatus: 'cash',
          note: de
            ? 'Nutzt Winter-/Frühjahrsfeuchte vor dem Hochsommerdefizit'
            : 'Uses winter/spring stored moisture ahead of mid-summer drought',
        },
        {
          months: [8, 9, 10, 11, 12],
          cropName: de ? 'Kichererbse + Phac.' : 'Chickpea + Phacelia',
          coverStatus: 'cover',
          note: de
            ? 'Eliminiert unproduktive Verdunstung der Stoppelbrache'
            : 'Eliminates late-summer bare stubble evaporation window',
        },
      ],
      lang
    ),
  };
  const y3 = {
    title: de ? 'Sommerkichererbse → Grünroggen + Ölrettich' : 'Spring Chickpea / Pea → Winter Rye Cover',
    months: fillMonths(
      [
        {
          months: [1, 2],
          cropName: de ? 'Abfrier-Mulch' : 'Frost-Killed Mulch',
          coverStatus: 'cover',
          note: de
            ? 'Schützende Mulchmatte puffert Frostwechsel im Oberboden'
            : 'Protective biomass mat buffers freeze-thaw cycles',
        },
        {
          months: [3, 4, 5, 6, 7],
          cropName: de ? 'Sommerkichererbse' : 'Spring Chickpea',
          coverStatus: 'cash',
          note: de
            ? 'Wassersparende Leguminose senkt Mineraldüngerbedarf'
            : 'Low-water legume diversifies root depth and cuts N fertilizer need',
        },
        {
          months: [8, 9, 10, 11, 12],
          cropName: de ? 'Roggen + Rettich' : 'Winter Rye + Radish',
          coverStatus: 'cover',
          note: de
            ? 'Pfahlwurzeln lösen Verdichtungen und füllen den Wasserspeicher'
            : 'Deep taproots break compaction and prepare Year 1 moisture bank',
        },
      ],
      lang
    ),
  };
  return repeatThreeYears(y1, y2, y3, peakHeat, dryMonths, lang);
}

function buildRegenerativeCalendar(
  baselineCrop: BaselineCropId,
  peakHeat: number[],
  dryMonths: number[],
  lang: AppLanguage
): CropCalendarYear[] {
  const de = lang === 'de';
  const isWarmBasin = baselineCrop === 'irrigated_alfalfa' || baselineCrop === 'rainfed_olive_cereal';

  if (isWarmBasin) {
    const y1 = {
      title: de ? 'Hafer + Inkarnatklee → Sommer-Begrünung' : 'Crimson Clover + Oats Companion → Summer Cover',
      months: fillMonths(
        [
          {
            months: [1, 2, 3, 4, 5],
            cropName: de ? 'Hafer + Inkarnatklee' : 'Oats + Crimson Clover',
            coverStatus: 'cash',
            note: de
              ? 'Bindet 70–100 kg N/ha und fördert stabile Krümelstruktur'
              : 'Fixes 70–100 kg N/ha while building fungal aggregate structure',
          },
          {
            months: [6, 7, 8, 9],
            cropName: de ? 'Sunn-Hanf Mulch' : 'Sunn Hemp Mulch',
            coverStatus: 'cover',
            note: de
              ? 'Tiefwurzelnde N-Sammler schützen den Boden vor Sommerhitze'
              : 'Deep nitrogen-fixing cover shields soil during intense summer sun',
          },
          {
            months: [10, 11, 12],
            cropName: de ? 'Wintererbse + Hafer' : 'Winter Pea + Oats',
            coverStatus: 'cover',
            note: de
              ? 'Dichtes Winterwurzelnetz erhöht die Infiltrationsrate'
              : 'Establishes dense winter root mat for infiltration',
          },
        ],
        lang
      ),
    };
    const y2 = {
      title: de ? 'Wintererbse + Gerste → Mulchauflage' : 'Winter Pea + Barley Intercrop → Stubble Armor',
      months: fillMonths(
        [
          {
            months: [1, 2, 3, 4, 5, 6],
            cropName: de ? 'Wintererbse + Gerste' : 'Winter Pea + Barley',
            coverStatus: 'cash',
            note: de
              ? 'Gemenge unterdrückt Beikräuter und teilt Wurzelhorizonte'
              : 'Symbiotic cereal-legume canopy suppresses weeds naturally',
          },
          {
            months: [7, 8, 9],
            cropName: de ? 'Biomasse-Mulch' : 'Rolled Biomass Armor',
            coverStatus: 'cover',
            note: de
              ? 'Direktsaatmulch schützt Bodenfeuchte & Mikrobiom'
              : 'Zero-tillage mulch preserves topsoil moisture & microbial life',
          },
          {
            months: [10, 11, 12],
            cropName: de ? 'Tiefwurz. Luzerne' : 'Deep-Root Alfalfa',
            coverStatus: 'cash',
            note: de
              ? 'Pfahlwurzel etabliert sich vor den Winterniederschlägen'
              : 'Deep taproot establishes before winter rains',
          },
        ],
        lang
      ),
    };
    const y3 = {
      title: de ? 'Mehrjährige Luzerne-Humusaufbauphase' : 'Perennial / Ley Alfalfa Soil-Building Phase',
      months: fillMonths(
        [
          {
            months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            cropName: de ? 'Tiefwurz. Luzerne' : 'Deep-Root Alfalfa',
            coverStatus: 'cash',
            note: de
              ? 'Ganzjährige Durchwurzelung baut Humus (C_org) & Wasserspeicher auf'
              : 'Year-round perennial living root boosts SOC and water infiltration rate',
          },
        ],
        lang
      ),
    };
    return repeatThreeYears(y1, y2, y3, peakHeat, dryMonths, lang);
  }

  const y1 = {
    title: de ? 'Inkarnatklee + Hafer → Ganzjahresbegrünung' : 'Crimson Clover + Oats → Multi-Species Cover',
    months: fillMonths(
      [
        {
          months: [1, 2],
          cropName: de ? 'Wintererbse-Zw.' : 'Winter Pea Cover',
          coverStatus: 'cover',
          note: de
            ? 'Überwinternde Leguminose schützt Krümelstruktur & bindet Nitrat'
            : 'Overwintering legume protects soil structure and prevents N leaching',
        },
        {
          months: [3, 4, 5, 6, 7],
          cropName: de ? 'Hafer + Klee' : 'Oats + Crimson Clover',
          coverStatus: 'cash',
          note: de
            ? 'Biomassenreiches Gemenge baut Humus auf und unterdrückt Unkraut'
            : 'High-biomass companion builds organic matter and suppresses weeds',
        },
        {
          months: [8, 9, 10, 11, 12],
          cropName: de ? 'Luzerne-Untersaat' : 'Alfalfa Establishment',
          coverStatus: 'cash',
          note: de
            ? 'Tiefwurzelnde Untersaat schließt jede Herbstbrache'
            : 'Under-sown deep-rooting legume eliminates autumn bare fallow',
        },
      ],
      lang
    ),
  };
  const y2 = {
    title: de ? 'Tiefwurzelnde Luzerne (Humus & Infiltration)' : 'Deep-Rooting Alfalfa Ley (Carbon & Infiltration)',
    months: fillMonths(
      [
        {
          months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
          cropName: de ? 'Tiefwurz. Luzerne' : 'Deep-Root Alfalfa',
          coverStatus: 'cash',
          note: de
            ? '2m Pfahlwurzeln brechen Pflugsohlen und fixieren >140 kg N/ha'
            : '2m taproots fracture plow pans, fix >140 kg N/ha, and boost water storage',
        },
      ],
      lang
    ),
  };
  const y3 = {
    title: de ? 'Qualitäts-Winterweizen → Wintererbse-Zw.' : 'High-Protein Winter Wheat → Winter Pea Cover',
    months: fillMonths(
      [
        {
          months: [1, 2, 3, 4, 5, 6, 7],
          cropName: de ? 'Qualitätsweizen' : 'Milling Winter Wheat',
          coverStatus: 'cash',
          note: de
            ? 'Profitiert von biologisch fixiertem N & verbessertem Bodenwasser'
            : 'Thrives on biologically fixed nitrogen & improved moisture retention',
        },
        {
          months: [8, 9, 10, 11, 12],
          cropName: de ? 'Klee + Wintererbse' : 'Crimson Clover + Pea',
          coverStatus: 'cover',
          note: de
            ? 'Direkte Stoppelsaat hält den Boden 12 Monate durchwurzelt'
            : 'Immediate post-harvest catch crop keeps living roots 12 months/year',
        },
      ],
      lang
    ),
  };
  return repeatThreeYears(y1, y2, y3, peakHeat, dryMonths, lang);
}

export function generateRotationScenarios(
  dataset: EarthSystemDataset,
  statsByVariable: Record<ClimateVariable, TrendStatistics>,
  baselineCrop: BaselineCropId,
  priorities: FarmerPriorities,
  lang: AppLanguage = 'en'
): {
  scenarios: RotationScenario[];
  radarData: RadarMetricPoint[];
} {
  const de = lang === 'de';
  const monthsShort = MONTH_SHORT_BY_LANG[lang];
  const t2m = statsByVariable.T2M;
  const precip = statsByVariable.PRECTOTCORR;
  const gwet = statsByVariable.GWETROOT;
  const evland = statsByVariable.EVLAND;
  const soil = dataset.soil;

  const isDrying = gwet.sensSlopePerDecade < 0 || precip.sensSlopePerDecade < 0;
  const isWarming = t2m.sensSlopePerDecade > 0;
  const dryingSeverity = Math.min(1, Math.max(0, -gwet.sensSlopePerDecade * 25));
  const warmingSeverity = Math.min(1, Math.max(0, t2m.sensSlopePerDecade * 1.4));
  const lowSocPenalty = soil.socPercent < 1.5 ? 8 : 0;
  const sandyDrainPenalty = soil.sandPercent > 45 ? 10 : 0;

  const totalW = Math.max(1, priorities.water + priorities.nitrogen + priorities.erosion + priorities.profit);
  const wWater = priorities.water / totalW;
  const wNitro = priorities.nitrogen / totalW;
  const wErosion = priorities.erosion / totalW;
  const wProfit = priorities.profit / totalW;

  const baselineRadar = {
    waterEfficiency: clampScore(42 - dryingSeverity * 16 - sandyDrainPenalty * 0.8),
    nitrogenFixation: clampScore(baselineCrop === 'soy_corn' || baselineCrop === 'irrigated_alfalfa' ? 48 : 24),
    erosionControl: clampScore(baselineCrop === 'irrigated_alfalfa' ? 54 : 32 - lowSocPenalty * 0.5),
    heatResilience: clampScore(44 - warmingSeverity * 15),
    economicStability: clampScore(68 - (dryingSeverity + warmingSeverity) * 14),
  };

  const hydroRadar = {
    waterEfficiency: clampScore(88 + (isDrying ? 6 : 0) - sandyDrainPenalty * 0.3),
    nitrogenFixation: clampScore(66 + (priorities.nitrogen > 60 ? 5 : 0)),
    erosionControl: clampScore(83 + (soil.clayPercent > 30 ? 4 : 0)),
    heatResilience: clampScore(90 + (isWarming ? 5 : 0)),
    economicStability: clampScore(78 + wProfit * 12 - (isDrying ? 0 : 4)),
  };

  const regenRadar = {
    waterEfficiency: clampScore(76 + (soil.socPercent < 2 ? 8 : 3)),
    nitrogenFixation: clampScore(94),
    erosionControl: clampScore(95),
    heatResilience: clampScore(78 + (soil.clayPercent > 25 ? 4 : 0)),
    economicStability: clampScore(74 + wNitro * 14 + wErosion * 8),
  };

  const computeFit = (r: typeof baselineRadar): number => {
    const score =
      r.waterEfficiency * wWater +
      r.nitrogenFixation * wNitro +
      r.erosionControl * wErosion +
      ((r.economicStability + r.heatResilience) / 2) * wProfit;
    return Math.round(score);
  };

  const baselineLabelMap: Record<BaselineCropId, string> = de
    ? {
        wheat_maize: 'Dauer-Winterweizen – Silomais',
        soy_corn: 'Monokultur Soja / Körnermais',
        irrigated_alfalfa: 'Bewässerte Luzerne – Jährliche Reihenkultur',
        rainfed_olive_cereal: 'Regenfeldbau Olive / Brache-Getreide',
      }
    : {
        wheat_maize: 'Continuous Winter Wheat – Silage Maize',
        soy_corn: 'Monoculture Soy / Corn Rotation',
        irrigated_alfalfa: 'Irrigated Alfalfa – Annual Row Crop',
        rainfed_olive_cereal: 'Rainfed Olive / Bare-Fallow Cereal',
      };

  const baselineLabel = baselineLabelMap[baselineCrop];
  const deficitMonthStr = dataset.moistureDeficitMonths.map((m) => monthsShort[m - 1]).join(', ');

  const baselineScenario: RotationScenario = {
    id: 'baseline',
    title: de ? 'Basis-Szenario (Aktuelle Praxis)' : 'Baseline (Current Practice)',
    subtitle: baselineLabel,
    badgeLabel: de ? 'Status-quo-Referenz' : 'Status Quo Reference',
    fitScore: computeFit(baselineRadar),
    cropsSummary: de
      ? 'Unveränderte Monokultur oder 2-Felder-Folge mit saisonalen Brache-Lücken.'
      : 'Unmodified monoculture or two-crop sequence with seasonal bare-soil gaps.',
    whySuggested: de
      ? `Referenzvergleich für ${dataset.regionName} (NASA POWER: T2M ${t2m.sensSlopePerDecade >= 0 ? '+' : ''}${t2m.sensSlopePerDecade.toFixed(2)} °C/Dek., ${formatPValue(t2m.pValue)}; Bodenfeuchte ${gwet.sensSlopePerDecade >= 0 ? '+' : ''}${gwet.sensSlopePerDecade.toFixed(3)}/Dek., ${formatPValue(gwet.pValue)}).`
      : `Reference benchmark evaluated against ${dataset.regionName} NASA POWER trends: T2M ${t2m.sensSlopePerDecade >= 0 ? '+' : ''}${t2m.sensSlopePerDecade.toFixed(2)} °C/dec (${formatPValue(t2m.pValue)}) and Root-Zone Moisture ${gwet.sensSlopePerDecade >= 0 ? '+' : ''}${gwet.sensSlopePerDecade.toFixed(3)}/dec (${formatPValue(gwet.pValue)}).`,
    expectedBenefits: de
      ? [
          'Keine sofortige Umstellung von Maschinenpark oder Saatgut-Lieferketten nötig.',
          'Gewohnte regionale Vermarktungswege und Erntezeitfenster.',
        ]
      : [
          'Requires zero immediate machinery or seed supply-chain retooling.',
          'Familiar regional marketing contracts and harvest scheduling.',
        ],
    risksAndValidation: de
      ? [
          `Unbedeckte Brachefenster erhöhen das Erosionsrisiko auf ${soil.textureClass} (C_org ${soil.socPercent}%).`,
          `Höchster Wasserbedarf fällt exakt in die Defizitmonate ${deficitMonthStr}.`,
          `Steigende Verdunstung (${evland.sensSlopePerDecade >= 0 ? '+' : ''}${evland.sensSlopePerDecade.toFixed(2)} mm/Tag/Dek.) schwächt Ertragsstabilität.`,
        ]
      : [
          `Exposes soil during bare fallow windows, increasing erosion risk on ${soil.textureClass} (SOC ${soil.socPercent}%).`,
          `Peak summer crop water demand collides with months ${deficitMonthStr}.`,
          `Rising evaporative demand (${evland.sensSlopePerDecade >= 0 ? '+' : ''}${evland.sensSlopePerDecade.toFixed(2)} mm/day/dec) erodes yield stability.`,
        ],
    radarScores: baselineRadar,
    calendarYears: buildBaselineCalendar(baselineCrop, dataset.peakHeatMonths, dataset.moistureDeficitMonths, lang),
  };

  const hydroScenario: RotationScenario = {
    id: 'hydro_resilient',
    title: de ? 'Hydro-Resiliente Umstellung' : 'Hydro-Resilient Shift',
    subtitle: de ? 'Sorghum · Kichererbse · Grünroggen-Mulch' : 'Sorghum · Chickpea · Winter Rye Cover',
    badgeLabel: de ? 'Wasser- & Hitzeschutz' : 'Water & Heat Shield',
    fitScore: computeFit(hydroRadar),
    cropsSummary: de
      ? 'Ersetzt wasserintensive Sommerkulturen durch C4-Trockengetreide, frühe Körnerleguminosen und Grünroggen.'
      : 'Replaces water-intensive summer phases with C4 drought-hardy cereals, early pulses, and winter rye mulch.',
    whySuggested: de
      ? `Abgeleitet aus ${gwet.isSignificant ? 'statistisch signifikanter' : 'beobachteter'} Wurzelraum-Austrocknung (${gwet.sensSlopePerDecade >= 0 ? '+' : ''}${gwet.sensSlopePerDecade.toFixed(3)}/Dek., ${formatPValue(gwet.pValue)}) und Erwärmung (${t2m.sensSlopePerDecade >= 0 ? '+' : ''}${t2m.sensSlopePerDecade.toFixed(2)} °C/Dek., ${formatPValue(t2m.pValue)}), kalibriert auf ${soil.textureClass} (pH ${soil.ph}).`
      : `Triggered by ${gwet.isSignificant ? 'statistically significant' : 'observed'} root-zone moisture drift (${gwet.sensSlopePerDecade >= 0 ? '+' : ''}${gwet.sensSlopePerDecade.toFixed(3)}/dec, ${formatPValue(gwet.pValue)}) and ${t2m.isSignificant ? 'confirmed' : 'measured'} warming (${t2m.sensSlopePerDecade >= 0 ? '+' : ''}${t2m.sensSlopePerDecade.toFixed(2)} °C/dec, ${formatPValue(t2m.pValue)}), calibrated for ${soil.textureClass} (pH ${soil.ph}).`,
    expectedBenefits: de
      ? [
          'Senkt den Wasserbedarf im Hochsommer um 25–35 % während der Hitzephasen.',
          'Erhält durchgehende Bodenbedeckung über alle 36 Monate.',
          'Streut das Einkommensrisiko über trockentolerante Körner und Hülsenfrüchte.',
        ]
      : [
          'Cuts peak mid-summer transpiration demand by 25–35% during heat-stress months.',
          'Maintains continuous living or rolled-mulch ground cover across all 36 months.',
          'Diversifies market income across drought-tolerant grains and nitrogen-fixing pulses.',
        ],
    risksAndValidation: de
      ? [
          'Regionale Abnahmeverträge für Körner-Sorghum oder Kichererbsen vorab sichern.',
          `Umbruchzeitpunkt des Grünroggens genau steuern, um Wasserkonkurrenz bei ${soil.sandPercent}% Sand zu vermeiden.`,
        ]
      : [
          'Requires local buyer contracts for grain sorghum or chickpea before scaling acreage.',
          `Monitor spring cover-crop termination timing so winter rye does not deplete moisture in ${soil.sandPercent}% sand topsoil.`,
        ],
    radarScores: hydroRadar,
    calendarYears: buildHydroResilientCalendar(baselineCrop, dataset.peakHeatMonths, dataset.moistureDeficitMonths, lang),
  };

  const regenScenario: RotationScenario = {
    id: 'regenerative_soil',
    title: de ? 'Regenerativer Boden-Aufbau' : 'Regenerative Soil Shift',
    subtitle: de ? 'Luzerne · Inkarnatklee · Hafer · Wintererbse' : 'Alfalfa · Crimson Clover · Oats · Winter Pea',
    badgeLabel: de ? 'Stickstoff- & Humusaufbau' : 'Nitrogen & Carbon Builder',
    fitScore: computeFit(regenRadar),
    cropsSummary: de
      ? 'Kombiniert tiefwurzelnde Leguminosen und Gemenge zur Steigerung von Humusgehalt und Infiltration.'
      : 'Integrates deep-taproot perennials and legume-cereal companions to rebuild organic carbon and infiltration.',
    whySuggested: de
      ? `Ausgerichtet auf SoilGrids C_org (${soil.socPercent}%) und ${precip.sensSlopePerDecade < 0 ? 'abnehmende' : 'intensivere'} Niederschläge (${precip.sensSlopePerDecade >= 0 ? '+' : ''}${precip.sensSlopePerDecade.toFixed(2)} mm/Tag/Dek., ${formatPValue(precip.pValue)}) für maximale Versickerung und biologische N-Bindung.`
      : `Designed to counteract SoilGrids SOC (${soil.socPercent}%) and ${precip.sensSlopePerDecade < 0 ? 'declining' : 'intensifying'} rainfall patterns (${precip.sensSlopePerDecade >= 0 ? '+' : ''}${precip.sensSlopePerDecade.toFixed(2)} mm/day/dec, ${formatPValue(precip.pValue)}) by maximizing infiltration and biological N fixation.`,
    expectedBenefits: de
      ? [
          'Fixiert 90–150 kg N/ha biologisch und reduziert Mineraldüngerkosten deutlich.',
          'Schließt 100 % der Erosions-Brachefenster über den gesamten 3-Jahres-Zyklus.',
          `Steigert die Wasserspeicherkapazität in ${soil.textureClass} (${soil.clayPercent}% Ton) durch Krümelstabilität.`,
        ]
      : [
          'Fixes 90–150 kg N/ha biologically, sharply lowering synthetic nitrogen input exposure.',
          'Eliminates 100% of bare-soil erosion windows across the 3-year cycle.',
          `Increases water-holding capacity in ${soil.textureClass} (${soil.clayPercent}% clay) by rebuilding soil aggregates.`,
        ],
    risksAndValidation: de
      ? [
          soil.ph < 6.0
            ? `Boden-pH (${soil.ph}) ist für Luzerne leicht sauer; Kalkung vor Jahr-2-Aussaat prüfen.`
            : `Futterverwertung oder Abnehmer für die Luzerne-Phase in Jahr 2–3 klären (pH ${soil.ph} ist optimal).`,
          'Höhere Saatgutkosten in Jahr 1–2 bevor Düngereinsparungen in Jahr 3 voll wirken.',
        ]
      : [
          soil.ph < 6.0
            ? `Soil pH (${soil.ph}) is slightly acidic for alfalfa; validate lime amendment before Year 2 establishment.`
            : `Verify forage market demand or livestock integration for the Year 2–3 alfalfa phase (soil pH ${soil.ph} is favorable).`,
          'Higher Year 1–2 seed diversity cost before fertilizer savings compound in Year 3.',
        ],
    radarScores: regenRadar,
    calendarYears: buildRegenerativeCalendar(baselineCrop, dataset.peakHeatMonths, dataset.moistureDeficitMonths, lang),
  };

  const radarData: RadarMetricPoint[] = [
    {
      axis: de ? 'Wassereffizienz' : 'Water Efficiency',
      baseline: baselineRadar.waterEfficiency,
      hydroResilient: hydroRadar.waterEfficiency,
      regenerativeSoil: regenRadar.waterEfficiency,
    },
    {
      axis: de ? 'N-Fixierung' : 'Nitrogen Fixation',
      baseline: baselineRadar.nitrogenFixation,
      hydroResilient: hydroRadar.nitrogenFixation,
      regenerativeSoil: regenRadar.nitrogenFixation,
    },
    {
      axis: de ? 'Erosionsschutz' : 'Erosion Control',
      baseline: baselineRadar.erosionControl,
      hydroResilient: hydroRadar.erosionControl,
      regenerativeSoil: regenRadar.erosionControl,
    },
    {
      axis: de ? 'Hitzeresilienz' : 'Heat Resilience',
      baseline: baselineRadar.heatResilience,
      hydroResilient: hydroRadar.heatResilience,
      regenerativeSoil: regenRadar.heatResilience,
    },
    {
      axis: de ? 'Ertragsstabilität' : 'Economic Stability',
      baseline: baselineRadar.economicStability,
      hydroResilient: hydroRadar.economicStability,
      regenerativeSoil: regenRadar.economicStability,
    },
  ];

  return {
    scenarios: [baselineScenario, hydroScenario, regenScenario],
    radarData,
  };
}
