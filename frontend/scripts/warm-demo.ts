/**
 * Warms every cache the demo presets touch, so a live demo never waits on NASA, ISRIC or model training:
 * NASA POWER point + regional grids and SoilGrids (server disk cache), plus the backend forecast,
 * soil, rotation and risk endpoints. Run with frontend and backend up:
 *
 *     npm run warm                      # all presets
 *     npm run warm -- 50.88,6.31        # extra sites as lat,lon
 */
import { PRESET_REGIONS } from '../src/data/presets';
import { nasaPowerMonthlyUrl, soilGridsUrl } from '../src/services/earthDataService';
import { HEATMAP_LAYERS, regionalGridUrl, type HeatmapLayerId } from '../src/services/regionalHeatmapService';

const APP = process.env.APP_URL ?? 'http://localhost:3000';
const sites = [
  ...PRESET_REGIONS.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })),
  ...process.argv.slice(2).map((arg) => {
    const [lat, lon] = arg.split(',').map(Number);
    return { name: arg, lat, lon };
  }),
];

async function hit(label: string, path: string): Promise<boolean> {
  const start = Date.now();
  try {
    const res = await fetch(`${APP}${path}`, { signal: AbortSignal.timeout(300_000) });
    const cache = res.headers.get('x-cache') ?? '';
    console.log(`  ${res.ok ? 'ok  ' : 'FAIL'} ${String(res.status).padEnd(4)}${String(Date.now() - start).padStart(7)} ms  ${label} ${cache}`);
    return res.ok;
  } catch (err) {
    console.log(`  FAIL      ${String(Date.now() - start).padStart(7)} ms  ${label}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

const cached = (url: string) => `/api/cached?url=${encodeURIComponent(url)}`;
let failed = 0;
for (const site of sites) {
  console.log(`${site.name} (${site.lat}, ${site.lon})`);
  const q = `lat=${site.lat}&lon=${site.lon}`;
  const checks: Array<[string, string]> = [
    ['NASA POWER monthly point', cached(nasaPowerMonthlyUrl(site.lat, site.lon))],
    ['ISRIC SoilGrids point', cached(soilGridsUrl(site.lat, site.lon))],
    ...(Object.keys(HEATMAP_LAYERS) as HeatmapLayerId[]).map(
      (id): [string, string] => [`NASA POWER regional ${id}`, cached(regionalGridUrl(id, site.lat, site.lon))]
    ),
    // Forecast first: the other backend endpoints reuse its trained models
    ['backend forecast', `/api/climate/forecast?${q}&years=3`],
    ['backend history', `/api/climate/history?${q}&start_year=1991`],
    ['backend agri-summary', `/api/climate/agri-summary?${q}&years=3`],
    ['backend risk', `/api/climate/risk?${q}&years=3`],
    ['backend soil', `/api/climate/soil?${q}`],
    ['backend rotation', `/api/climate/rotation?${q}&years=3`],
  ];
  for (const [label, path] of checks) if (!(await hit(label, path))) failed++;
}
console.log(failed ? `\n${failed} request(s) failed, run again before the demo.` : '\nAll caches warm.');
process.exit(failed ? 1 : 0);
