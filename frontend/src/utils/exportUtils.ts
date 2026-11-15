import { jsPDF } from 'jspdf';
import {
  SEASONAL_TEXT,
  VARIABLE_TEXT,
  localizeRegionName,
  localizeSoilTexture,
  type AppLanguage,
} from '../i18n/translations';
import { VARIABLE_META, localizeTrendClassification, unitLabel } from './statistics';
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
    `# AgriShift Geospatial Telemetry Export`,
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
    `agrishift_${slug || 'site'}_${variable}_${mode}.csv`,
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
    `agrishift_${slug || 'site'}_${variable}.geojson`,
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

  const de = lang === 'de';
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const maxWidth = pageWidth - marginX * 2;
  const GREEN: [number, number, number] = [16, 150, 105];
  const DARK: [number, number, number] = [20, 24, 30];
  const MUTED: [number, number, number] = [90, 100, 112];
  const LINE: [number, number, number] = [225, 229, 235];
  const TOP = 20;
  let y = TOP;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageHeight - 18) {
      doc.addPage();
      y = TOP;
    }
  };

  // The built-in helvetica has no arrows: they would print as garbage
  const clean = (t: string) => t.replace(/[→⇒]/g, '>').trim();

  const writeWrapped = (text: string, fontSize = 10, lineHeight = 5, bold = false, x = marginX) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(clean(text), pageWidth - marginX - x) as string[];
    ensureSpace(lines.length * lineHeight + 2);
    doc.setLineHeightFactor(lineHeight / (fontSize * 0.3528)); // drawn spacing must match the y advance
    doc.text(lines, x, y);
    y += lines.length * lineHeight;
  };

  const section = (title: string) => {
    ensureSpace(16);
    y += 3;
    doc.setFillColor(...GREEN);
    doc.rect(marginX, y - 4.6, 1.6, 6.4, 'F');
    doc.setTextColor(...DARK);
    writeWrapped(title, 12.5, 6, true, marginX + 4);
    y += 2;
  };

  const regionLabel = localizeRegionName(dataset.regionName, dataset.lat, dataset.lon, lang);
  const textureLabel = localizeSoilTexture(dataset.soil.textureClass, lang);
  const windowLabel = SEASONAL_TEXT[lang][seasonalWindow].label;
  const slug = regionLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // Header band
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageWidth, 38, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('AgriShift', marginX, 17);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(de ? 'Standort- & Klimabericht' : 'Site & Climate Report', marginX, 25);
  doc.setFontSize(9);
  doc.text(
    new Date().toLocaleDateString(de ? 'de-DE' : 'en-US'),
    pageWidth - marginX,
    17,
    { align: 'right' }
  );
  y = 50;

  doc.setTextColor(...DARK);
  writeWrapped(regionLabel, 15, 7, true);
  doc.setTextColor(...MUTED);
  writeWrapped(
    `${dataset.lat.toFixed(4)}°, ${dataset.lon.toFixed(4)}° (WGS84)  ·  ${windowLabel}  ·  ${
      de ? 'Ausblick' : 'Forecast'
    }: ${forecastMode}`,
    9.5,
    5
  );
  if (dataset.fieldAreaStats) {
    writeWrapped(
      de
        ? `Feld: ${dataset.fieldAreaStats.areaHectares.toFixed(2)} ha · ${dataset.fieldAreaStats.samplePointsCount} Messpunkte · Umfang ${dataset.fieldAreaStats.perimeterMeters} m`
        : `Field: ${dataset.fieldAreaStats.areaHectares.toFixed(2)} ha · ${dataset.fieldAreaStats.samplePointsCount} sample points · perimeter ${dataset.fieldAreaStats.perimeterMeters} m`,
      9.5,
      5
    );
  }
  y += 2;

  // 1. Soil: four stat boxes
  section(de ? 'Bodenprofil (ISRIC SoilGrids, 0–30 cm)' : 'Topsoil Profile (ISRIC SoilGrids, 0–30 cm)');
  const soilBoxes: Array<[string, string]> = [
    [de ? 'Bodenart' : 'Texture', textureLabel],
    [
      `${de ? 'Ton' : 'Clay'} / ${de ? 'Schluff' : 'Silt'} / Sand`,
      `${dataset.soil.clayPercent} / ${dataset.soil.siltPercent} / ${dataset.soil.sandPercent} %`,
    ],
    ['pH', dataset.soil.ph.toFixed(1)],
    [de ? 'Org. Kohlenstoff' : 'Org. Carbon', `${dataset.soil.socPercent.toFixed(2)} %`],
  ];
  const gap = 3;
  const boxW = (maxWidth - gap * 3) / 4;
  ensureSpace(20);
  soilBoxes.forEach(([label, value], i) => {
    const x = marginX + i * (boxW + gap);
    doc.setFillColor(244, 247, 249);
    doc.setDrawColor(...LINE);
    doc.roundedRect(x, y, boxW, 15, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(label, boxW - 4) as string[], x + 2.5, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...DARK);
    doc.text(doc.splitTextToSize(value, boxW - 4) as string[], x + 2.5, y + 11.5);
  });
  y += 22;

  // 2. Climate trends: table
  section(
    de ? 'Klimaverlauf & Trendtest (1990–2025)' : 'Climate Trends & Mann-Kendall Test (1990–2025)'
  );
  const cols = [marginX, marginX + 50, marginX + 88, marginX + 102, marginX + 124, pageWidth - marginX];
  const head = de
    ? ['Variable', 'Trend / Dekade', 'Z', 'p-Wert', 'Einordnung']
    : ['Variable', 'Trend / decade', 'Z', 'p-value', 'Classification'];
  doc.setFillColor(238, 242, 245);
  doc.rect(marginX, y - 4, maxWidth, 6.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  head.forEach((h, i) => doc.text(h, cols[i] + 1.5, y));
  y += 6.5;

  const vars: ClimateVariable[] = ['T2M', 'PRECTOTCORR', 'GWETROOT', 'EVLAND'];
  for (const v of vars) {
    const st = statsByVariable[v];
    const dec = v === 'GWETROOT' ? 3 : 2;
    const sign = st.sensSlopePerDecade >= 0 ? '+' : '';
    const pTxt = st.pValue < 0.001 ? '< 0.001' : st.pValue.toFixed(4);
    const label = VARIABLE_TEXT[lang][v].label + (v === selectedVariable ? ' •' : '');
    const cells = [
      label,
      `${sign}${st.sensSlopePerDecade.toFixed(dec)} ${unitLabel(v, lang)}`,
      st.mannKendallZ.toFixed(2),
      pTxt,
      localizeTrendClassification(st, lang),
    ];
    const wrapped = cells.map(
      (c, i) => doc.splitTextToSize(clean(c), cols[i + 1] - cols[i] - 2) as string[]
    );
    const rows = Math.max(...wrapped.map((w) => w.length));
    ensureSpace(rows * 4.4 + 3);
    doc.setFont('helvetica', v === selectedVariable ? 'bold' : 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    wrapped.forEach((w, i) => doc.text(w, cols[i] + 1.5, y));
    y += rows * 4.4 + 1.2;
    doc.setDrawColor(...LINE);
    doc.line(marginX, y - 2.6, pageWidth - marginX, y - 2.6);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  y += 1;
  writeWrapped(
    de ? '• = aktuell gewählte Variable. Trend: Sen-Steigung.' : '• = currently selected variable. Trend: Sen\'s slope.',
    8,
    4
  );

  if (thresholdFinding) {
    y += 2;
    const note = `${de ? 'Schwellenwert-Ausblick' : '2035 Threshold Note'}: ${
      de ? thresholdFinding.messageDe : thresholdFinding.messageEn
    }`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(clean(note), maxWidth - 8) as string[];
    ensureSpace(lines.length * 4.8 + 6);
    doc.setFillColor(254, 243, 226);
    doc.rect(marginX, y - 3.5, maxWidth, lines.length * 4.8 + 4, 'F');
    doc.setFillColor(217, 119, 6);
    doc.rect(marginX, y - 3.5, 1.2, lines.length * 4.8 + 4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(140, 75, 10);
    doc.setLineHeightFactor(4.8 / (9.5 * 0.3528));
    doc.text(lines, marginX + 4, y);
    y += lines.length * 4.8 + 3;
  }

  // 3. Rotation scenarios with fit bar
  section(de ? '3-Jahres-Fruchtfolgen im Vergleich' : '3-Year Crop Rotation Scenarios');
  for (const sc of scenarios) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.2);
    const bodyLines =
      (doc.splitTextToSize(clean(sc.whySuggested), maxWidth) as string[]).length +
      (doc.splitTextToSize(clean(sc.cropsSummary), maxWidth) as string[]).length;
    ensureSpace(14 + bodyLines * 4.5);
    doc.setTextColor(...DARK);
    writeWrapped(sc.title, 10.5, 5, true);
    // fit score bar
    const barW = 40;
    doc.setFillColor(...LINE);
    doc.roundedRect(marginX, y - 2, barW, 2.2, 1, 1, 'F');
    doc.setFillColor(...GREEN);
    doc.roundedRect(marginX, y - 2, Math.max(1.5, (barW * sc.fitScore) / 100), 2.2, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...GREEN);
    doc.text(`${sc.fitScore}/100`, marginX + barW + 2.5, y);
    y += 4.5;
    doc.setTextColor(...MUTED);
    writeWrapped(sc.cropsSummary, 9, 4.4);
    doc.setTextColor(65, 74, 86);
    writeWrapped(sc.whySuggested, 9.2, 4.5);
    y += 3;
  }

  // 4. Site summary
  if (briefing) {
    section(de ? 'Standort-Auswertung' : 'Site Summary');
    doc.setTextColor(50, 58, 68);
    writeWrapped(briefing.executiveSummary, 9.5, 4.8);
    y += 2;
    for (const action of briefing.recommendedActionPlan) {
      doc.setFillColor(...GREEN);
      ensureSpace(6);
      doc.circle(marginX + 1.2, y - 1.2, 0.7, 'F');
      writeWrapped(action, 9.3, 4.6, false, marginX + 4);
      y += 0.8;
    }
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.line(marginX, pageHeight - 13, pageWidth - marginX, pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      de
        ? 'AgriShift · Daten: NASA POWER, ISRIC SoilGrids, Copernicus'
        : 'AgriShift · Data: NASA POWER, ISRIC SoilGrids, Copernicus',
      marginX,
      pageHeight - 8
    );
    doc.text(`${p} / ${pages}`, pageWidth - marginX, pageHeight - 8, { align: 'right' });
  }

  doc.save(`agrishift_${slug || 'site'}_${selectedVariable}.pdf`);
}
