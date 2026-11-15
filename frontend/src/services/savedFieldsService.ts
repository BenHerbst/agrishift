/**
 * Saved sites and drawn fields, kept in this browser's localStorage (no accounts, nothing leaves
 * the device). Reads are validated because storage can hold anything from older versions.
 */
import { useCallback, useEffect, useState } from 'react';
import type { DrawnFieldPolygon } from '../types/terrashift';

export interface SavedField {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** null for a plain map point */
  field: DrawnFieldPolygon | null;
  savedAt: string;
}

const STORAGE_KEY = 'terra-tuta-saved-fields';
const CHANGE_EVENT = 'terra-tuta-saved-fields-change';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isSavedField(v: unknown): v is SavedField {
  const s = v as SavedField;
  return (
    !!s &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    isNum(s.lat) &&
    isNum(s.lon) &&
    (s.field === null ||
      (Array.isArray(s.field?.coordinates) &&
        s.field.coordinates.every((c) => Array.isArray(c) && isNum(c[0]) && isNum(c[1])) &&
        isNum(s.field.areaHectares)))
  );
}

export function loadSavedFields(): SavedField[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSavedField) : [];
  } catch {
    return [];
  }
}

function persist(fields: SavedField[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fields));
  } catch {
    // storage blocked or full: the list still works for this session
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Same place and same outline (or both plain points). */
type SiteKey = Pick<SavedField, 'lat' | 'lon' | 'field'>;
const siteKey = (s: SiteKey) => `${s.lat.toFixed(4)},${s.lon.toFixed(4)},${s.field ? s.field.areaHectares.toFixed(2) : 'pt'}`;

export function isSameSite(a: SiteKey, b: SiteKey) {
  return siteKey(a) === siteKey(b);
}

export function useSavedFields() {
  const [fields, setFields] = useState<SavedField[]>(loadSavedFields);

  useEffect(() => {
    const sync = () => setFields(loadSavedFields());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync); // other tabs
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const save = useCallback((entry: Omit<SavedField, 'id' | 'savedAt'>) => {
    const next = [
      { ...entry, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, savedAt: new Date().toISOString() },
      ...loadSavedFields().filter((f) => !isSameSite(f, entry)),
    ];
    setFields(next);
    persist(next);
  }, []);

  const remove = useCallback((id: string) => {
    const next = loadSavedFields().filter((f) => f.id !== id);
    setFields(next);
    persist(next);
  }, []);

  return { fields, save, remove };
}
