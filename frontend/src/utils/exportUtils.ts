import { jsPDF } from 'jspdf';
import {
  SEASONAL_TEXT,
  VARIABLE_TEXT,
  localizeRegionName,
  localizeSoilTexture,
  type AppLanguage,
} from '../i18n/translations';
import { VARIABLE_META, localizeTrendClassification } from './statistics';
import type {
  AgroBriefingResponse,
  AnnualPoint,
  ClimateVariable,
  EarthSystemDataset,
  ForecastMode,
  RotationScenario,
  SeasonalWindow,
  ThresholdFinding,
  TrendStatistics,
} from '../types/terrashift';

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportTimeSeriesCsv(
  dataset: EarthSystemDataset,
  variable: ClimateVariable,
  window: SeasonalWindow,
  mode: ForecastMode,
  series: AnnualPoint[],
  stats: TrendStatistics
) {
  const slug = dataset.regionName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const fieldNote = dataset.fieldAreaStats
    ? `# Field Polygon Average: ${dataset.fieldAreaStats.areaHectares.toFixed(2)} ha | Perimeter: ${dataset.fieldAreaStats.perimeterMeters} m | Sample Points: ${dataset.fieldAreaStats.samplePointsCount}`
    : null;
  const lines = [
    `# Terra Tuta Geospatial Telemetry Export`,
    `# Site: ${dataset.regionName}`,
    `# Coordinates (WGS84): ${dataset.lat.toFixed(4)}, ${dataset.lon.toFixed(4)}`,
    ...(fieldNote ? [fieldNote] : []),
    `# Variable: ${variable} | Window: ${window} | Forecast Mode: ${mode}`,
    `# Mann-Kendall Z: ${stats.mannKendallZ.toFixed(4)} | p-value: ${stats.pValue.toFixed(6)} | Sens Slope (/dec): ${stats.sensSlopePerDecade.toFixed(4)} | Residual SE: ${stats.residualSE.toFixed(4)}`,
    'year,observed_value,moving_avg_5yr,ols_trend,projected_value,ci_95_lower,ci_95_upper,anomaly_vs_1990_2000',
  ];

  for (const pt of series) {
    lines.push(
      [
        pt.year,
        pt.value ?? '',
        pt.movingAvg5Yr ?? '',
        pt.trendLine ?? '',
        pt.projectedValue ?? '',
        pt.ciLower ?? '',
        pt.ciUpper ?? '',
        pt.anomaly ?? '',
      ].join(',')
    );
  }

  triggerDownload(
    `terratuta_${slug || 'site'}_${variable}_${mode}.csv`,
    lines.join('\n'),
    'text/csv;charset=utf-8'
  );
}

export function exportSiteGeoJson(
  dataset: EarthSystemDataset,
  variable: ClimateVariable,
  window: SeasonalWindow,
  mode: ForecastMode,
  stats: TrendStatistics,
  scenarios: RotationScenario[]
) {
  const slug = dataset.regionName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const geometry =
    dataset.fieldAreaStats && dataset.fieldAreaStats.polygonCoordinates.length >= 3
      ? {
          type: 'Polygon',
          coordinates: [
            [
              ...dataset.fieldAreaStats.polygonCoordinates,
              dataset.fieldAreaStats.polygonCoordinates[0],
            ],
          ],
        }
      : {
          type: 'Point',
          coordinates: [dataset.lon, dataset.lat],
        };

  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry,
        properties: {
          siteName: dataset.regionName,
          crs: 'WGS84',
          gridResolution: '0.5° x 0.625° (MERRA-2)',
          soilGridResolution: '250m ISRIC v2.0',
          ...(dataset.fieldAreaStats
            ? {
                fieldAverage: {
                  areaHectares: dataset.fieldAreaStats.areaHectares,
                  perimeterMeters: dataset.fieldAreaStats.perimeterMeters,
                  samplePointsCount: dataset.fieldAreaStats.samplePointsCount,
                },
              }
            : {}),
          powerApiSource: dataset.powerSource,
          powerLatencyMs: dataset.powerLatencyMs,
          soilProfile: dataset.soil,
          activeDiagnostic: {
            variable,
            seasonalWindow: window,
            forecastMode: mode,
            mannKendallZ: Number(stats.mannKendallZ.toFixed(4)),
            pValue: Number(stats.pValue.toFixed(6)),
            sensSlopePerDecade: Number(stats.sensSlopePerDecade.toFixed(4)),
            residualSE: Number(stats.residualSE.toFixed(4)),
            classification: stats.classificationLabel,
          },
          rotationScenarios: scenarios.map((s) => ({
            id: s.id,
            title: s.title,
            fitScore: s.fitScore,
            radarScores: s.radarScores,
          })),
          exportedAtIso: new Date().toISOString(),
        },
      },
    ],
  };

  triggerDownload(
    `terratuta_${slug || 'site'}_${variable}.geojson`,
    JSON.stringify(geojson, null, 2),
    'application/geo+json;charset=utf-8'
  );
}

export function exportSitePdfReport(params: {
  lang: AppLanguage;
  dataset: EarthSystemDataset;
  selectedVariable: ClimateVariable;
  seasonalWindow: SeasonalWindow;
  forecastMode: ForecastMode;
  statsByVariable: Record<ClimateVariable, TrendStatistics>;
  thresholdFinding: ThresholdFinding | null;
  scenarios: RotationScenario[];
  briefing: AgroBriefingResponse | null;
}) {
  const {
    lang,
    dataset,
    selectedVariable,
    seasonalWindow,
    forecastMode,
    statsByVariable,
    thresholdFinding,
    scenarios,
    briefing,
  } = params;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const maxWidth = pageWidth - marginX * 2;
  let y = 18;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageHeight - 16) {
      doc.addPage();
      y = 18;
    }
  };

  const writeWrapped = (text: string, fontSize = 10, lineHeight = 5, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    ensureSpace(lines.length * lineHeight + 2);
    doc.text(lines, marginX, y);
    y += lines.length * lineHeight;
  };

  const regionLabel = localizeRegionName(dataset.regionName, dataset.lat, dataset.lon, lang);
  const textureLabel = localizeSoilTexture(dataset.soil.textureClass, lang);
  const windowLabel = SEASONAL_TEXT[lang][seasonalWindow].label;
  const slug = regionLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // Title Header
  doc.setTextColor(20, 24, 30);
  writeWrapped(
    lang === 'de'
      ? `Terra Tuta — Standort- & Klimabericht`
      : `Terra Tuta — Site & Climate Report`,
    16,
    7,
    true
  );
  y += 1;

  doc.setTextColor(80, 90, 102);
  writeWrapped(
    `${regionLabel}  |  ${dataset.lat.toFixed(4)}°, ${dataset.lon.toFixed(4)}° (WGS84)  |  ${windowLabel}`,
    9.5,
    4.8,
    false
  );
  if (dataset.fieldAreaStats) {
    writeWrapped(
      lang === 'de'
        ? `Feld-Durchschnitt: ${dataset.fieldAreaStats.areaHectares.toFixed(2)} ha (${dataset.fieldAreaStats.samplePointsCount} Messpunkte, Umfang ${dataset.fieldAreaStats.perimeterMeters} m)`
        : `Field Average: ${dataset.fieldAreaStats.areaHectares.toFixed(2)} ha (${dataset.fieldAreaStats.samplePointsCount} sample points, perimeter ${dataset.fieldAreaStats.perimeterMeters} m)`,
      9.2,
      4.6,
      false
    );
  }
  writeWrapped(
    `${lang === 'de' ? 'Erstellt am' : 'Generated'}: ${new Date().toLocaleDateString(
      lang === 'de' ? 'de-DE' : 'en-US'
    )}  |  ${lang === 'de' ? 'Ausblick' : 'Forecast'}: ${forecastMode}`,
    9,
    4.5,
    false
  );

  y += 3;
  doc.setDrawColor(210, 215, 222);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 6;

  // Section 1: Soil Profile
  doc.setTextColor(20, 24, 30);
  writeWrapped(
    lang === 'de' ? '1. Bodenprofil (ISRIC SoilGrids 0–30 cm)' : '1. Topsoil Profile (ISRIC SoilGrids 0–30 cm)',
    12,
    6,
    true
  );
  y += 1;
  doc.setTextColor(50, 58, 68);
  writeWrapped(
    `${lang === 'de' ? 'Bodenart' : 'Texture'}: ${textureLabel} (${dataset.soil.clayPercent}% ${
      lang === 'de' ? 'Ton' : 'Clay'
    }, ${dataset.soil.siltPercent}% ${lang === 'de' ? 'Schluff' : 'Silt'}, ${dataset.soil.sandPercent}% Sand)  |  pH ${dataset.soil.ph.toFixed(
      1
    )}  |  ${lang === 'de' ? 'Org. Kohlenstoff' : 'Org. Carbon'}: ${dataset.soil.socPercent.toFixed(2)}%`,
    10,
    5
  );
  y += 4;

  // Section 2: Climate Trend Statistics
  doc.setTextColor(20, 24, 30);
  writeWrapped(
    lang === 'de'
      ? '2. Klimaverlauf & Trendtest (1990–2025)'
      : '2. Climate Trends & Mann-Kendall Test (1990–2025)',
    12,
    6,
    true
  );
  y += 1;
  doc.setTextColor(50, 58, 68);

  const vars: ClimateVariable[] = ['T2M', 'PRECTOTCORR', 'GWETROOT', 'EVLAND'];
  for (const v of vars) {
    const st = statsByVariable[v];
    const meta = VARIABLE_META[v];
    const label = VARIABLE_TEXT[lang][v].label;
    const dec = v === 'GWETROOT' ? 3 : 2;
    const sign = st.sensSlopePerDecade >= 0 ? '+' : '';
    const pTxt = st.pValue < 0.001 ? '< 0.001' : st.pValue.toFixed(4);
    const classTxt = localizeTrendClassification(st, lang);
    const activeMark = v === selectedVariable ? (lang === 'de' ? ' [Aktiv]' : ' [Active]') : '';

    writeWrapped(
      `• ${label}${activeMark}: ${sign}${st.sensSlopePerDecade.toFixed(dec)} ${meta.unit}/${
        lang === 'de' ? 'Dekade' : 'decade'
      }  |  Z = ${st.mannKendallZ.toFixed(2)}, p = ${pTxt} (${st.confidencePct.toFixed(1)}%) — ${classTxt}`,
      9.5,
      4.8
    );
  }

  if (thresholdFinding) {
    y += 1.5;
    doc.setTextColor(140, 75, 10);
    writeWrapped(
      `${lang === 'de' ? 'Schwellenwert-Ausblick' : '2035 Threshold Note'}: ${
        lang === 'de' ? thresholdFinding.messageDe : thresholdFinding.messageEn
      }`,
      9.5,
      4.8,
      true
    );
  }
  y += 4;

  // Section 3: Crop Rotation Scenarios
  doc.setTextColor(20, 24, 30);
  writeWrapped(
    lang === 'de' ? '3. 3-Jahres-Fruchtfolgen im Vergleich' : '3. 3-Year Crop Rotation Scenarios',
    12,
    6,
    true
  );
  y += 1;

  for (const sc of scenarios) {
    doc.setTextColor(20, 24, 30);
    writeWrapped(`• ${sc.title} (${sc.fitScore}/100) — ${sc.cropsSummary}`, 10, 5, true);
    doc.setTextColor(65, 74, 86);
    writeWrapped(`  ${sc.whySuggested}`, 9.3, 4.6);
    y += 1.5;
  }

  // Section 4: Site Summary if available
  if (briefing) {
    y += 3;
    doc.setTextColor(20, 24, 30);
    writeWrapped(
      lang === 'de' ? '4. Standort-Auswertung' : '4. Site Summary',
      12,
      6,
      true
    );
    y += 1;
    doc.setTextColor(50, 58, 68);
    writeWrapped(briefing.executiveSummary, 9.5, 4.8);
    y += 2;
    for (const action of briefing.recommendedActionPlan) {
      writeWrapped(`- ${action}`, 9.3, 4.6);
    }
  }

  doc.save(`terratuta_${slug || 'site'}_${selectedVariable}.pdf`);
}
