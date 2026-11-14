import type {
  ClimateVariable,
  MonthlyClimatologyPoint,
  MonthlyRecord,
  PresetRegion,
  SoilProfile,
} from '../types/terrashift';

export const PRESET_REGIONS: PresetRegion[] = [
  {
    id: 'aachen',
    name: 'Rheinisches Revier / Aachen, Germany',
    shortName: 'Aachen, DE',
    country: 'Germany',
    lat: 50.7753,
    lon: 6.0839,
    climateZone: 'Temperate Maritime Loess Belt',
    defaultBaselineCrop: 'wheat_maize',
    summary: 'Deep fertile loess soils experiencing accelerating summer heat stress and spring-to-summer moisture deficits.',
  },
  {
    id: 'central_valley',
    name: 'Central Valley, California, USA',
    shortName: 'Central Valley, US',
    country: 'United States',
    lat: 36.7783,
    lon: -119.4179,
    climateZone: 'Semi-Arid Mediterranean Basin',
    defaultBaselineCrop: 'irrigated_alfalfa',
    summary: 'High evaporative demand basin facing warming winters, groundwater pressure, and prolonged summer vapor-pressure deficits.',
  },
  {
    id: 'andalusia',
    name: 'Andalusia Olive Belt, Spain',
    shortName: 'Andalusia, ES',
    country: 'Spain',
    lat: 37.5443,
    lon: -4.7278,
    climateZone: 'Warm Mediterranean Dryland',
    defaultBaselineCrop: 'rainfed_olive_cereal',
    summary: 'Steep erosion-prone calcareous hills confronting severe drying trends and intense autumn cloudburst runoff.',
  },
  {
    id: 'iowa',
    name: 'Midwest Corn Belt, Iowa, USA',
    shortName: 'Iowa Corn Belt, US',
    country: 'United States',
    lat: 41.8780,
    lon: -93.0977,
    climateZone: 'Humid Continental Prairie Mollisol',
    defaultBaselineCrop: 'soy_corn',
    summary: 'Carbon-rich prairie soils seeing heavier spring rainfall events coupled with warmer mid-summer night temperatures.',
  },
];

// Deterministic PRNG seeded by coordinates so fallback curves remain repeatable and geographically realistic
function seededRandom(seed: number): () => number {
  let state = Math.floor(Math.abs(seed) * 100000) % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

interface ClimateArchetype {
  baseTemp: number;
  tempAmp: number;
  tempTrendPerYear: number;
  basePrecip: number;
  precipSummerFactor: number;
  precipTrendPerYear: number;
  baseWet: number;
  wetTrendPerYear: number;
  baseEvap: number;
  evapTrendPerYear: number;
  soil: Omit<SoilProfile, 'source' | 'latencyMs'>;
}

function getArchetypeForCoords(lat: number, lon: number): ClimateArchetype {
  // Match known presets closely, otherwise derive from latitude/longitude
  if (Math.abs(lat - 50.7753) < 1.5 && Math.abs(lon - 6.0839) < 1.5) {
    return {
      baseTemp: 10.1,
      tempAmp: 8.6,
      tempTrendPerYear: 0.046,
      basePrecip: 2.25,
      precipSummerFactor: 1.05,
      precipTrendPerYear: -0.005,
      baseWet: 0.67,
      wetTrendPerYear: -0.0024,
      baseEvap: 1.55,
      evapTrendPerYear: 0.0085,
      soil: { ph: 6.7, socPercent: 1.9, clayPercent: 21, sandPercent: 19, siltPercent: 60, textureClass: 'Silt Loam' },
    };
  }
  if (Math.abs(lat - 36.7783) < 1.8 && Math.abs(lon - -119.4179) < 1.8) {
    return {
      baseTemp: 17.6,
      tempAmp: 10.2,
      tempTrendPerYear: 0.042,
      basePrecip: 0.92,
      precipSummerFactor: 0.12,
      precipTrendPerYear: -0.0042,
      baseWet: 0.34,
      wetTrendPerYear: -0.0028,
      baseEvap: 1.92,
      evapTrendPerYear: 0.0065,
      soil: { ph: 7.4, socPercent: 1.1, clayPercent: 24, sandPercent: 42, siltPercent: 34, textureClass: 'Loam' },
    };
  }
  if (Math.abs(lat - 37.5443) < 1.8 && Math.abs(lon - -4.7278) < 1.8) {
    return {
      baseTemp: 18.2,
      tempAmp: 9.8,
      tempTrendPerYear: 0.052,
      basePrecip: 1.38,
      precipSummerFactor: 0.18,
      precipTrendPerYear: -0.0095,
      baseWet: 0.41,
      wetTrendPerYear: -0.0033,
      baseEvap: 1.78,
      evapTrendPerYear: 0.0042,
      soil: { ph: 7.8, socPercent: 0.9, clayPercent: 34, sandPercent: 28, siltPercent: 38, textureClass: 'Clay Loam' },
    };
  }
  if (Math.abs(lat - 41.8780) < 2.0 && Math.abs(lon - -93.0977) < 2.0) {
    return {
      baseTemp: 9.8,
      tempAmp: 14.5,
      tempTrendPerYear: 0.035,
      basePrecip: 2.58,
      precipSummerFactor: 1.45,
      precipTrendPerYear: 0.0075,
      baseWet: 0.64,
      wetTrendPerYear: 0.0009,
      baseEvap: 1.85,
      evapTrendPerYear: 0.0072,
      soil: { ph: 6.4, socPercent: 3.1, clayPercent: 28, sandPercent: 26, siltPercent: 46, textureClass: 'Clay Loam' },
    };
  }

  // Generic latitudinal heuristic for arbitrary clicked coordinates
  const absLat = Math.abs(lat);
  const baseTemp = Math.max(-2, 27 - absLat * 0.36);
  const tempAmp = 3 + absLat * 0.21;
  const isSubtropicalDry = absLat >= 22 && absLat <= 39;
  const basePrecip = isSubtropicalDry ? 1.35 : 2.35;
  const baseWet = isSubtropicalDry ? 0.42 : 0.62;
  const clay = Math.round(18 + ((Math.abs(lat * 7 + lon * 3) % 20)));
  const sand = Math.round(25 + ((Math.abs(lon * 5 + lat * 2) % 30)));
  const silt = Math.max(10, 100 - clay - sand);

  return {
    baseTemp,
    tempAmp,
    tempTrendPerYear: 0.036 + (absLat > 45 ? 0.014 : 0.004),
    basePrecip,
    precipSummerFactor: isSubtropicalDry ? 0.45 : 1.15,
    precipTrendPerYear: isSubtropicalDry ? -0.006 : 0.003,
    baseWet,
    wetTrendPerYear: isSubtropicalDry ? -0.0022 : -0.0008,
    baseEvap: Math.max(0.8, 2.3 - absLat * 0.018),
    evapTrendPerYear: 0.0055,
    soil: {
      ph: Number((6.2 + (absLat % 1.4)).toFixed(1)),
      socPercent: Number((1.2 + (absLat > 40 ? 1.1 : 0.3)).toFixed(2)),
      clayPercent: clay,
      sandPercent: sand,
      siltPercent: silt,
      textureClass: classifySoilTexture(clay, sand, silt),
    },
  };
}

export function classifySoilTexture(clay: number, sand: number, silt: number): string {
  if (clay >= 40) return 'Clay';
  if (clay >= 27 && sand <= 45) return 'Clay Loam';
  if (sand >= 70 && clay < 15) return 'Sandy Loam';
  if (silt >= 50 && clay < 27) return 'Silt Loam';
  if (sand >= 45 && clay >= 20) return 'Sandy Clay Loam';
  return 'Loam';
}

export function generateFallbackSeries(
  lat: number,
  lon: number
): {
  recordsByVariable: Record<ClimateVariable, MonthlyRecord[]>;
  soil: SoilProfile;
} {
  const arch = getArchetypeForCoords(lat, lon);
  const rand = seededRandom(lat * 31.7 + lon * 17.3);
  const southHemisphereShift = lat < 0 ? 6 : 0;

  const t2mRecords: MonthlyRecord[] = [];
  const precipRecords: MonthlyRecord[] = [];
  const gwetRecords: MonthlyRecord[] = [];
  const evapRecords: MonthlyRecord[] = [];

  for (let year = 1990; year <= 2025; year++) {
    const dt = year - 1990;
    const annualWarmPulse = (rand() - 0.5) * 1.15;
    const annualRainPulse = 0.78 + rand() * 0.46;

    for (let month = 1; month <= 12; month++) {
      const shiftedMonth = ((month - 1 + southHemisphereShift) % 12) + 1;
      const seasonWave = -Math.cos(((shiftedMonth - 1) / 12) * 2 * Math.PI); // -1 Jan, +1 Jul

      const t2m =
        arch.baseTemp +
        arch.tempAmp * seasonWave +
        arch.tempTrendPerYear * dt +
        annualWarmPulse +
        (rand() - 0.5) * 0.9;

      const summerWeight = (seasonWave + 1) / 2;
      const seasonalPrecipMult = 1 + (arch.precipSummerFactor - 1) * summerWeight;
      const precip = Math.max(
        0.02,
        (arch.basePrecip * seasonalPrecipMult + arch.precipTrendPerYear * dt) *
          annualRainPulse *
          (0.75 + rand() * 0.5)
      );

      const gwet = Math.min(
        0.95,
        Math.max(
          0.12,
          arch.baseWet -
            0.14 * seasonWave +
            arch.wetTrendPerYear * dt +
            (annualRainPulse - 1) * 0.1 +
            (rand() - 0.5) * 0.045
        )
      );

      const evap = Math.max(
        0.15,
        arch.baseEvap * (0.55 + 0.75 * summerWeight) +
          arch.evapTrendPerYear * dt +
          (rand() - 0.5) * 0.22
      );

      t2mRecords.push({ year, month, value: Number(t2m.toFixed(2)) });
      precipRecords.push({ year, month, value: Number(precip.toFixed(2)) });
      gwetRecords.push({ year, month, value: Number(gwet.toFixed(3)) });
      evapRecords.push({ year, month, value: Number(evap.toFixed(2)) });
    }
  }

  return {
    recordsByVariable: {
      T2M: t2mRecords,
      PRECTOTCORR: precipRecords,
      GWETROOT: gwetRecords,
      EVLAND: evapRecords,
    },
    soil: {
      ...arch.soil,
      source: 'fallback',
      latencyMs: 0,
    },
  };
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function computeMonthlyClimatology(
  recordsByVariable: Record<ClimateVariable, MonthlyRecord[]>
): {
  climatology: MonthlyClimatologyPoint[];
  peakHeatMonths: number[];
  moistureDeficitMonths: number[];
} {
  const climatology: MonthlyClimatologyPoint[] = [];

  for (let m = 1; m <= 12; m++) {
    const avg = (varName: ClimateVariable): number => {
      const vals = recordsByVariable[varName]
        .filter((r) => r.month === m && r.value > -900)
        .map((r) => r.value);
      if (vals.length === 0) return 0;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    climatology.push({
      month: m,
      label: MONTH_SHORT[m - 1],
      t2m: Number(avg('T2M').toFixed(2)),
      prectotcorr: Number(avg('PRECTOTCORR').toFixed(2)),
      gwetroot: Number(avg('GWETROOT').toFixed(3)),
      evland: Number(avg('EVLAND').toFixed(2)),
    });
  }

  // Peak heat stress: top 2 warmest months above 20°C (or top 2 overall if cooler)
  const sortedByHeat = [...climatology].sort((a, b) => b.t2m - a.t2m);
  const peakHeatMonths = sortedByHeat
    .slice(0, 3)
    .filter((m, idx) => idx < 2 || m.t2m > 22)
    .map((m) => m.month);

  // Moisture deficit: months with lowest GWETROOT or where ET > Precip significantly
  const sortedByDry = [...climatology].sort((a, b) => a.gwetroot - b.gwetroot);
  const moistureDeficitMonths = sortedByDry.slice(0, 3).map((m) => m.month);

  return { climatology, peakHeatMonths, moistureDeficitMonths };
}
