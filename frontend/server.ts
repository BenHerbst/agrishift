import 'dotenv/config';
import express from 'express';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import type { AgroBriefingRequest, AgroBriefingResponse } from './src/types/terrashift';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);

// AgriShift forecast backend (FastAPI, ../backend). The browser never talks to it directly:
// every /api/climate/* request is forwarded here so the app stays same-origin.
const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
// The first request for a new location downloads ~45 years of data and trains all models (1–2 min).
const BACKEND_TIMEOUT_MS = Number(process.env.BACKEND_TIMEOUT_MS ?? 240_000);

// Disk cache for third-party data the browser would otherwise re-download on every visit
// (NASA POWER, SoilGrids, reverse geocoding) and for the Gemini briefing. Locations visited
// once load instantly afterwards, in any browser and across server restarts.
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHEABLE_HOSTS = new Set(['power.larc.nasa.gov', 'rest.isric.org', 'nominatim.openstreetmap.org']);
const UPSTREAM_TIMEOUT_MS = 60_000;

function cachePath(kind: string, key: string): string {
  return path.join(CACHE_DIR, kind, `${createHash('sha256').update(key).digest('hex').slice(0, 24)}.json`);
}

async function readCache(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function writeCache(file: string, body: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, file); // atomic: a crash never leaves half a file behind
}

function buildDeterministicBriefing(payload: AgroBriefingRequest): AgroBriefingResponse {
  const { lang = 'en', regionName, lat, lon, seasonalWindow, soil, statsByVariable, priorities, recommendedScenario } = payload;
  const t2m = statsByVariable.T2M;
  const precip = statsByVariable.PRECTOTCORR;
  const gwet = statsByVariable.GWETROOT;
  const evland = statsByVariable.EVLAND;

  const fmtP = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(4)}`);
  const decUnit = lang === 'de' ? 'Dekade' : 'decade';
  const fmtSlope = (v: number, unit: string) => `${v >= 0 ? '+' : ''}${v.toFixed(3)} ${unit}/${decUnit}`;

  const topPriority = Object.entries(priorities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'water';

  if (lang === 'de') {
    const windowLabelDe =
      seasonalWindow === 'summer_jja'
        ? 'Sommer-Wachstumsphase (Jun–Aug)'
        : seasonalWindow === 'spring_mam'
        ? 'Frühjahrs-Aussaatfenster (Mär–Mai)'
        : 'Jahresmittel';
    const prioDe =
      topPriority === 'water'
        ? 'Wassereinsparung'
        : topPriority === 'nitrogen'
        ? 'Stickstoff- & Humusaufbau'
        : topPriority === 'erosion'
        ? 'Erosionsschutz'
        : 'Ertragsstabilität';

    return {
      headline: `Standort-Auswertung: ${regionName}`,
      executiveSummary: `Auf Basis der NASA-POWER-Klimadaten (1990–2025, ${windowLabelDe}) bei ${lat.toFixed(3)}°, ${lon.toFixed(3)}° und dem ISRIC-Bodenprofil 0–30 cm (${soil.textureClass}, pH ${soil.ph}, ${soil.socPercent}% C_org) zeigt der Standort ${t2m.isSignificant ? 'einen klaren Erwärmungstrend' : 'starke jährliche Temperaturschwankungen'} (${fmtSlope(t2m.sensSlopePerDecade, '°C')}, ${fmtP(t2m.pValue)}) bei einer Bodenfeuchte-Änderung von ${fmtSlope(gwet.sensSlopePerDecade, 'Anteil')} (${fmtP(gwet.pValue)}). Mit Schwerpunkt auf ${prioDe} passt die Fruchtfolge „${recommendedScenario.title}“ (${recommendedScenario.cropsSummary}).`,
      climateSignalFindings: [
        `Temperatur (2m): Änderungsrate ${fmtSlope(t2m.sensSlopePerDecade, '°C')}, Mann-Kendall Z = ${t2m.mannKendallZ.toFixed(2)}, ${fmtP(t2m.pValue)}.`,
        `Wurzelraum-Bodenfeuchte: Änderungsrate ${fmtSlope(gwet.sensSlopePerDecade, 'Anteil')}, Z = ${gwet.mannKendallZ.toFixed(2)}, ${fmtP(gwet.pValue)}.`,
        `Niederschlag & Verdunstung: Niederschlag ${fmtSlope(precip.sensSlopePerDecade, 'mm/Tag')} (${fmtP(precip.pValue)}) gegenüber Verdunstung ${fmtSlope(evland.sensSlopePerDecade, 'mm/Tag')} (${fmtP(evland.pValue)}).`,
        `Oberboden (0–30 cm): ${soil.textureClass} (${soil.clayPercent}% Ton, ${soil.sandPercent}% Sand), pH ${soil.ph}, organischer Kohlenstoff ${soil.socPercent}%.`,
      ],
      recommendedActionPlan: [
        `Umstellung auf „${recommendedScenario.title}“: ${recommendedScenario.whySuggested}`,
        `Brache-Lücken durch lebende Winter-Zwischenfrüchte schließen, um Verdunstung und Erosion auf ${soil.textureClass} zu bremsen.`,
        `Hauptwasserbedarf durch frühreifende Sorten oder C4-Kulturen aus den Spitzenmonaten von Hitze und Trockenheit verlagern.`,
      ],
      validationChecklist: [
        `Aktuellen Oberboden-pH (${soil.ph}) und Nmin-Reststickstoff vor der Leguminosen-Aussaat im Labor prüfen.`,
        `Abnahmeverträge und Umbruchtermine für Zwischenfrüchte mit der regionalen Beratung abstimmen.`,
        `Frühjahrs- (MAM) und Sommer-Trends (JJA) vor der Saatgutbestellung gegenprüfen.`,
      ],
      generatedBy: 'deterministic-engine',
      generatedAtIso: new Date().toISOString(),
    };
  }

  const windowLabel =
    seasonalWindow === 'summer_jja'
      ? 'Summer Growing Season (Jun–Aug)'
      : seasonalWindow === 'spring_mam'
      ? 'Spring Planting Window (Mar–May)'
      : 'Annual Mean';

  return {
    headline: `Site Summary: ${regionName}`,
    executiveSummary: `Based on 1990–2025 NASA POWER weather records (${windowLabel}) at ${lat.toFixed(3)}°, ${lon.toFixed(3)}° and ISRIC SoilGrids 0–30 cm properties (${soil.textureClass}, pH ${soil.ph}, ${soil.socPercent}% SOC), the site shows ${t2m.isSignificant ? 'a clear warming trend' : 'year-to-year temperature swings'} (${fmtSlope(t2m.sensSlopePerDecade, '°C')}, ${fmtP(t2m.pValue)}) alongside a root-zone moisture rate of ${fmtSlope(gwet.sensSlopePerDecade, 'fraction')} (${fmtP(gwet.pValue)}). With priority on ${topPriority}, "${recommendedScenario.title}" (${recommendedScenario.cropsSummary}) fits well.`,
    climateSignalFindings: [
      `Temperature (2m): Sen's Slope ${fmtSlope(t2m.sensSlopePerDecade, '°C')}, Mann-Kendall Z = ${t2m.mannKendallZ.toFixed(2)}, ${fmtP(t2m.pValue)}.`,
      `Root-Zone Moisture: Sen's Slope ${fmtSlope(gwet.sensSlopePerDecade, 'fraction')}, Z = ${gwet.mannKendallZ.toFixed(2)}, ${fmtP(gwet.pValue)}.`,
      `Rainfall & Evaporation: Precipitation ${fmtSlope(precip.sensSlopePerDecade, 'mm/day')} (${fmtP(precip.pValue)}) vs. ET ${fmtSlope(evland.sensSlopePerDecade, 'mm/day')} (${fmtP(evland.pValue)}).`,
      `Topsoil (0–30 cm): ${soil.textureClass} (${soil.clayPercent}% clay, ${soil.sandPercent}% sand), pH ${soil.ph}, Soil Organic Carbon ${soil.socPercent}%.`,
    ],
    recommendedActionPlan: [
      `Shift toward "${recommendedScenario.title}": ${recommendedScenario.whySuggested}`,
      `Close bare-soil fallow gaps with living winter cover crops to reduce evaporation and protect ${soil.textureClass} topsoil.`,
      `Move peak crop water demand away from the hottest, driest summer weeks with early-maturing or C4 cultivars.`,
    ],
    validationChecklist: [
      `Confirm local topsoil pH (${soil.ph}) and lab nitrate-N residual across management zones before seeding legumes.`,
      'Verify regional grain or forage contracts and cover-crop termination dates with local extension advisers.',
      'Compare Spring (MAM) vs. Summer (JJA) trends before locking in multi-year seed orders.',
    ],
    generatedBy: 'deterministic-engine',
    generatedAtIso: new Date().toISOString(),
  };
}

async function generateGeminiBriefing(payload: AgroBriefingRequest): Promise<AgroBriefingResponse> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    return buildDeterministicBriefing(payload);
  }

  const targetLanguageName = payload.lang === 'de' ? 'German (Deutsch)' : 'English';

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const promptText = `You are a senior agronomist writing clear, practical field notes for a farm manager.
Respond strictly in ${targetLanguageName}. Write naturally without buzzwords or jargon.
Analyze the following 1990-2025 NASA POWER climate trend data, ISRIC SoilGrids 0-30cm metrics, and farm priorities, and produce a concise, factual summary.

Location: ${payload.regionName} (${payload.lat.toFixed(4)}, ${payload.lon.toFixed(4)})
Seasonal Window: ${payload.seasonalWindow}
SoilGrids 0-30cm: ${payload.soil.textureClass}, pH ${payload.soil.ph}, SOC ${payload.soil.socPercent}%, Clay ${payload.soil.clayPercent}%, Sand ${payload.soil.sandPercent}%
Current Baseline System: ${payload.baselineCropLabel}
Farmer Priorities (0-100): Water=${payload.priorities.water}, Nitrogen=${payload.priorities.nitrogen}, Erosion=${payload.priorities.erosion}, Profit=${payload.priorities.profit}
Top Recommended Strategy: ${payload.recommendedScenario.title} — ${payload.recommendedScenario.cropsSummary}

Mann-Kendall & Sen's Slope Results (1990-2025):
- T2M: Sen=${payload.statsByVariable.T2M.sensSlopePerDecade.toFixed(3)} C/dec, Z=${payload.statsByVariable.T2M.mannKendallZ.toFixed(2)}, p=${payload.statsByVariable.T2M.pValue.toFixed(4)} (${payload.statsByVariable.T2M.classificationLabel})
- PRECTOTCORR: Sen=${payload.statsByVariable.PRECTOTCORR.sensSlopePerDecade.toFixed(3)} mm/day/dec, Z=${payload.statsByVariable.PRECTOTCORR.mannKendallZ.toFixed(2)}, p=${payload.statsByVariable.PRECTOTCORR.pValue.toFixed(4)}
- GWETROOT: Sen=${payload.statsByVariable.GWETROOT.sensSlopePerDecade.toFixed(4)}/dec, Z=${payload.statsByVariable.GWETROOT.mannKendallZ.toFixed(2)}, p=${payload.statsByVariable.GWETROOT.pValue.toFixed(4)}
- EVLAND: Sen=${payload.statsByVariable.EVLAND.sensSlopePerDecade.toFixed(3)} mm/day/dec, Z=${payload.statsByVariable.EVLAND.mannKendallZ.toFixed(2)}, p=${payload.statsByVariable.EVLAND.pValue.toFixed(4)}

Keep all findings tightly grounded in these exact numbers. Cite p-values and Sen's slopes explicitly.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: promptText,
      config: {
        systemInstruction: `Return concise, clear agronomic summaries in ${targetLanguageName}, grounded strictly in the provided measurements without marketing clichés.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING },
            executiveSummary: { type: Type.STRING },
            climateSignalFindings: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            recommendedActionPlan: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            validationChecklist: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: [
            'headline',
            'executiveSummary',
            'climateSignalFindings',
            'recommendedActionPlan',
            'validationChecklist',
          ],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      return buildDeterministicBriefing(payload);
    }

    const parsed = JSON.parse(rawText) as Omit<AgroBriefingResponse, 'generatedBy' | 'generatedAtIso'>;
    return {
      ...parsed,
      generatedBy: 'gemini-2.5-flash',
      generatedAtIso: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('Gemini briefing unavailable, using deterministic engine:', err instanceof Error ? err.message : err);
    return buildDeterministicBriefing(payload);
  }
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  app.use(express.json({ limit: '1mb' }));

  // Reverse proxy: GET /api/climate/forecast?lat=..&lon=.. -> GET {BACKEND_URL}/forecast?lat=..&lon=..
  // app.use strips the mount prefix from req.url and works with both Express 4 and 5.
  app.use('/api/climate', async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).json({ detail: 'Only GET is proxied to the forecast backend.' });
      return;
    }
    const target = `${BACKEND_URL}${req.url}`;
    try {
      const upstream = await fetch(target, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      });
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      console.warn(
        `Forecast backend ${timedOut ? 'timed out' : 'unreachable'} at ${target}:`,
        error instanceof Error ? error.message : error
      );
      res.status(timedOut ? 504 : 503).json({
        detail: timedOut
          ? `Forecast backend did not answer within ${Math.round(BACKEND_TIMEOUT_MS / 1000)} s (the first request for a new location trains all models).`
          : `Forecast backend unreachable at ${BACKEND_URL}. Start it with: cd backend && uvicorn app.main:app --reload`,
      });
    }
  });

  // GET /api/cached?url=<encoded upstream URL>: only successful JSON responses are stored, so a
  // failed request is retried next time instead of being cached.
  app.get('/api/cached', async (req, res) => {
    const raw = typeof req.query.url === 'string' ? req.query.url : '';
    let upstreamUrl: URL;
    try {
      upstreamUrl = new URL(raw);
    } catch {
      res.status(400).json({ error: 'Missing or invalid url parameter.' });
      return;
    }
    if (upstreamUrl.protocol !== 'https:' || !CACHEABLE_HOSTS.has(upstreamUrl.hostname)) {
      res.status(403).json({ error: `Host not allowed: ${upstreamUrl.hostname}` });
      return;
    }
    const file = cachePath('http', upstreamUrl.href);
    const cached = await readCache(file);
    if (cached !== null) {
      res.type('application/json').setHeader('x-cache', 'hit').send(cached);
      return;
    }
    try {
      const upstream = await fetch(upstreamUrl, {
        headers: { accept: 'application/json', 'user-agent': 'AgriShift/1.0 (farm climate analysis)' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const body = await upstream.text();
      if (upstream.ok) {
        JSON.parse(body); // never cache an HTML error page served with 200
        await writeCache(file, body);
      }
      res.status(upstream.status).type('application/json').setHeader('x-cache', 'miss').send(body);
    } catch (error) {
      console.warn(`Upstream ${upstreamUrl.hostname} failed:`, error instanceof Error ? error.message : error);
      res.status(502).json({ error: `Upstream ${upstreamUrl.hostname} unavailable.` });
    }
  });

  app.post('/api/agro-detective', async (req, res) => {
    try {
      const payload = req.body as AgroBriefingRequest;
      if (!payload || !payload.statsByVariable || !payload.soil) {
        res.status(400).json({ error: 'Missing required climate statistics or soil profile.' });
        return;
      }
      // Request timings differ on every visit and don't affect the briefing
      const file = cachePath('briefing', JSON.stringify(payload, (k, v) => (k === 'latencyMs' ? undefined : v)));
      const cached = await readCache(file);
      if (cached !== null) {
        res.type('application/json').setHeader('x-cache', 'hit').send(cached);
        return;
      }
      const briefing = await generateGeminiBriefing(payload);
      // The deterministic fallback is not cached, so Gemini is tried again on the next visit
      if (briefing.generatedBy !== 'deterministic-engine') {
        await writeCache(file, JSON.stringify(briefing));
      }
      res.json(briefing);
    } catch (error) {
      console.error('Agro-detective endpoint error:', error);
      res.status(500).json({ error: 'Failed to generate agro-detective briefing.' });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AgriShift server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
