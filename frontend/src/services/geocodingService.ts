import { PRESET_REGIONS } from '../data/presets';
import { PRESET_TEXT, type AppLanguage } from '../i18n/translations';

export interface GeocodingResult {
  id: string;
  name: string;
  admin1?: string;
  country: string;
  lat: number;
  lon: number;
  displayLabel: string;
}

interface BuiltinPlaceEntry {
  id: string;
  nameEn: string;
  nameDe: string;
  countryEn: string;
  countryDe: string;
  lat: number;
  lon: number;
  displayEn: string;
  displayDe: string;
}

const BUILTIN_PLACES: BuiltinPlaceEntry[] = [
  ...PRESET_REGIONS.map((p) => ({
    id: `preset-${p.id}`,
    nameEn: PRESET_TEXT.en[p.id]?.name ?? p.name,
    nameDe: PRESET_TEXT.de[p.id]?.name ?? p.name,
    countryEn: p.country,
    countryDe: p.country,
    lat: p.lat,
    lon: p.lon,
    displayEn: PRESET_TEXT.en[p.id]?.name ?? p.name,
    displayDe: PRESET_TEXT.de[p.id]?.name ?? p.name,
  })),
  { id: 'berlin', nameEn: 'Berlin', nameDe: 'Berlin', countryEn: 'Germany', countryDe: 'Deutschland', lat: 52.52, lon: 13.405, displayEn: 'Berlin, Germany', displayDe: 'Berlin, Deutschland' },
  { id: 'munich', nameEn: 'Munich', nameDe: 'München', countryEn: 'Germany', countryDe: 'Deutschland', lat: 48.1351, lon: 11.582, displayEn: 'Munich, Bavaria, Germany', displayDe: 'München, Bayern, Deutschland' },
  { id: 'cologne', nameEn: 'Cologne', nameDe: 'Köln', countryEn: 'Germany', countryDe: 'Deutschland', lat: 50.9375, lon: 6.9603, displayEn: 'Cologne, North Rhine-Westphalia, Germany', displayDe: 'Köln, Nordrhein-Westfalen, Deutschland' },
  { id: 'hamburg', nameEn: 'Hamburg', nameDe: 'Hamburg', countryEn: 'Germany', countryDe: 'Deutschland', lat: 53.5511, lon: 9.9937, displayEn: 'Hamburg, Germany', displayDe: 'Hamburg, Deutschland' },
  { id: 'stuttgart', nameEn: 'Stuttgart', nameDe: 'Stuttgart', countryEn: 'Germany', countryDe: 'Deutschland', lat: 48.7758, lon: 9.1829, displayEn: 'Stuttgart, Baden-Württemberg, Germany', displayDe: 'Stuttgart, Baden-Württemberg, Deutschland' },
  { id: 'paris', nameEn: 'Paris', nameDe: 'Paris', countryEn: 'France', countryDe: 'Frankreich', lat: 48.8566, lon: 2.3522, displayEn: 'Paris, France', displayDe: 'Paris, Frankreich' },
  { id: 'madrid', nameEn: 'Madrid', nameDe: 'Madrid', countryEn: 'Spain', countryDe: 'Spanien', lat: 40.4168, lon: -3.7038, displayEn: 'Madrid, Spain', displayDe: 'Madrid, Spanien' },
  { id: 'seville', nameEn: 'Seville', nameDe: 'Sevilla', countryEn: 'Spain', countryDe: 'Spanien', lat: 37.3891, lon: -5.9845, displayEn: 'Seville, Andalusia, Spain', displayDe: 'Sevilla, Andalusien, Spanien' },
  { id: 'rome', nameEn: 'Rome', nameDe: 'Rom', countryEn: 'Italy', countryDe: 'Italien', lat: 41.9028, lon: 12.4964, displayEn: 'Rome, Lazio, Italy', displayDe: 'Rom, Latium, Italien' },
  { id: 'amsterdam', nameEn: 'Amsterdam', nameDe: 'Amsterdam', countryEn: 'Netherlands', countryDe: 'Niederlande', lat: 52.3676, lon: 4.9041, displayEn: 'Amsterdam, Netherlands', displayDe: 'Amsterdam, Niederlande' },
  { id: 'zurich', nameEn: 'Zurich', nameDe: 'Zürich', countryEn: 'Switzerland', countryDe: 'Schweiz', lat: 47.3769, lon: 8.5417, displayEn: 'Zurich, Switzerland', displayDe: 'Zürich, Schweiz' },
  { id: 'london', nameEn: 'London', nameDe: 'London', countryEn: 'United Kingdom', countryDe: 'Vereinigtes Königreich', lat: 51.5074, lon: -0.1278, displayEn: 'London, United Kingdom', displayDe: 'London, Vereinigtes Königreich' },
  { id: 'fresno', nameEn: 'Fresno', nameDe: 'Fresno', countryEn: 'United States', countryDe: 'USA', lat: 36.7378, lon: -119.7871, displayEn: 'Fresno, California, United States', displayDe: 'Fresno, Kalifornien, USA' },
  { id: 'des_moines', nameEn: 'Des Moines', nameDe: 'Des Moines', countryEn: 'United States', countryDe: 'USA', lat: 41.5868, lon: -93.625, displayEn: 'Des Moines, Iowa, United States', displayDe: 'Des Moines, Iowa, USA' },
  { id: 'nairobi', nameEn: 'Nairobi', nameDe: 'Nairobi', countryEn: 'Kenya', countryDe: 'Kenia', lat: -1.2921, lon: 36.8219, displayEn: 'Nairobi, Kenya', displayDe: 'Nairobi, Kenia' },
  { id: 'sao_paulo', nameEn: 'São Paulo', nameDe: 'São Paulo', countryEn: 'Brazil', countryDe: 'Brasilien', lat: -23.5505, lon: -46.6333, displayEn: 'São Paulo, Brazil', displayDe: 'São Paulo, Brasilien' },
];

// Photon (komoot): free OpenStreetMap search built for search-as-you-type, no key
interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type: string;
    osm_id: number;
    name?: string;
    state?: string;
    country?: string;
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
  lang: AppLanguage = 'de'
): Promise<GeocodingResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      trimmed
    )}&limit=6&lang=${lang}&osm_tag=place`;
    const res = await fetch(url, { signal: controller.signal });
    if (res.ok) {
      const data = (await res.json()) as PhotonResponse;
      const places = (data.features ?? []).filter((f) => f.properties.name);
      if (places.length > 0) {
        return places.map(({ geometry, properties: item }) => {
          const parts = [item.name, item.state, item.country].filter(Boolean);
          return {
            id: `osm-${item.osm_type}${item.osm_id}`,
            name: item.name as string,
            admin1: item.state,
            country: item.country ?? '',
            lat: geometry.coordinates[1],
            lon: geometry.coordinates[0],
            displayLabel: parts.join(', '),
          };
        });
      }
    }
  } catch {
    // Fall through to local fallback list
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  const lower = trimmed.toLowerCase();
  return BUILTIN_PLACES.filter(
    (p) =>
      p.nameEn.toLowerCase().includes(lower) ||
      p.nameDe.toLowerCase().includes(lower) ||
      p.displayEn.toLowerCase().includes(lower) ||
      p.displayDe.toLowerCase().includes(lower) ||
      p.countryEn.toLowerCase().includes(lower) ||
      p.countryDe.toLowerCase().includes(lower)
  )
    .slice(0, 6)
    .map((p) => ({
      id: p.id,
      name: lang === 'de' ? p.nameDe : p.nameEn,
      country: lang === 'de' ? p.countryDe : p.countryEn,
      lat: p.lat,
      lon: p.lon,
      displayLabel: lang === 'de' ? p.displayDe : p.displayEn,
    }));
}

export async function reverseGeocode(
  lat: number,
  lon: number,
  lang: AppLanguage = 'de'
): Promise<string> {
  const latHem = lat >= 0 ? 'N' : 'S';
  const lonHem = lon >= 0 ? 'E' : 'W';
  const coordFallback = `${Math.abs(lat).toFixed(3)}°${latHem}, ${Math.abs(lon).toFixed(3)}°${lonHem}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat.toFixed(
      4
    )}&lon=${lon.toFixed(4)}&zoom=10&accept-language=${lang}`;
    // Disk-cached by the Express server (server.ts, /api/cached)
    const res = await fetch(`/api/cached?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    if (!res.ok) return coordFallback;
    const json = (await res.json()) as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        county?: string;
        state?: string;
        country?: string;
      };
    };
    const addr = json.address;
    if (!addr) return coordFallback;
    const locality = addr.city || addr.town || addr.village || addr.county;
    const parts = [locality, addr.state, addr.country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : coordFallback;
  } catch {
    return coordFallback;
  } finally {
    clearTimeout(timer);
  }
}

export function getCurrentBrowserLocation(lang: AppLanguage = 'de'): Promise<{
  lat: number;
  lon: number;
  label: string;
}> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(
        new Error(
          lang === 'de'
            ? 'Standortbestimmung wird von diesem Browser nicht unterstützt.'
            : 'Geolocation is not supported by this browser.'
        )
      );
      return;
    }

    const onSuccess: PositionCallback = async (position) => {
        const lat = Number(position.coords.latitude.toFixed(4));
        const lon = Number(position.coords.longitude.toFixed(4));
        const resolvedName = await reverseGeocode(lat, lon, lang);
        resolve({
          lat,
          lon,
          label: `${resolvedName} (${lang === 'de' ? 'Aktueller Standort' : 'Current Location'})`,
        });
    };
    const onError: PositionErrorCallback = (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new Error(
              lang === 'de'
                ? 'Standortzugriff verweigert. Bitte Standortfreigabe erlauben oder einen Ort eingeben.'
                : 'Location permission denied. Please allow location access or enter a place name.'
            )
          );
        } else if (err.code === err.TIMEOUT) {
          reject(
            new Error(
              lang === 'de'
                ? 'Zeitüberschreitung bei der Standortabfrage. Bitte erneut versuchen oder Ort eingeben.'
                : 'Location request timed out. Please try again or enter a place name.'
            )
          );
        } else {
          reject(
            new Error(
              lang === 'de'
                ? 'Aktueller Standort konnte nicht ermittelt werden. Bitte Ort eingeben.'
                : 'Could not determine current location. Please enter a place name.'
            )
          );
        }
    };

    // GPS / Wi-Fi fix first (exact, no cached position); if that is not available fall back to a coarse one
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) return onError(err);
        navigator.geolocation.getCurrentPosition(onSuccess, onError, {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60000,
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}
