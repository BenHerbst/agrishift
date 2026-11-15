import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bookmark, BookmarkCheck, ChevronDown, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { isSameSite, useSavedFields, type SavedField } from '../services/savedFieldsService';
import type { DrawnFieldPolygon } from '../types/terrashift';

/** The field's outline (or a pin for a plain point), scaled into a small square. */
export function FieldGlyph({ field, className = 'h-9 w-9' }: { field: DrawnFieldPolygon | null; className?: string }) {
  if (!field || field.coordinates.length < 3) {
    return (
      <svg viewBox="0 0 36 36" className={`${className} shrink-0`} aria-hidden="true">
        <rect x="0.5" y="0.5" width="35" height="35" rx="6" fill="var(--color-raised)" />
        <circle cx="18" cy="18" r="6" fill="none" stroke="var(--color-crop)" strokeWidth="2" />
        <circle cx="18" cy="18" r="2" fill="var(--color-crop)" />
      </svg>
    );
  }
  const k = Math.cos((field.centroidLat * Math.PI) / 180);
  const pts = field.coordinates.map(([lon, lat]) => [lon * k, -lat]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const pad = 6;
  const scale = (36 - 2 * pad) / span;
  const offX = pad + (36 - 2 * pad - (Math.max(...xs) - minX) * scale) / 2;
  const offY = pad + (36 - 2 * pad - (Math.max(...ys) - minY) * scale) / 2;
  const d = pts.map(([x, y]) => `${(offX + (x - minX) * scale).toFixed(1)},${(offY + (y - minY) * scale).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 36 36" className={`${className} shrink-0`} aria-hidden="true">
      <rect x="0.5" y="0.5" width="35" height="35" rx="6" fill="var(--color-raised)" />
      <polygon points={d} fill="color-mix(in srgb, var(--color-crop) 28%, transparent)" stroke="var(--color-crop)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function savedFieldMeta(f: SavedField, pointLabel: string): string {
  return f.field
    ? `${f.field.areaHectares.toFixed(1)} ha`
    : `${pointLabel} ${f.lat.toFixed(3)}, ${f.lon.toFixed(3)}`;
}

interface SavedFieldsMenuProps {
  current: { lat: number; lon: number; name: string; field: DrawnFieldPolygon | null };
  onLoad: (field: SavedField) => void;
}

export function SavedFieldsMenu({ current, onLoad }: SavedFieldsMenuProps) {
  const { t } = useI18n();
  const { fields, save, remove } = useSavedFields();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const currentSaved = fields.find((f) => isSameSite(f, current));

  useEffect(() => {
    if (!open) return;
    setName(current.name);
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill only when the menu opens
  }, [open]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    save({ name: trimmed.slice(0, 60), lat: current.lat, lon: current.lon, field: current.field });
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors duration-200 ease-out cursor-pointer whitespace-nowrap ${
          currentSaved
            ? 'border-crop/45 bg-crop/10 text-crop'
            : 'border-line bg-panel text-ink hover:border-line-strong'
        }`}
      >
        {currentSaved ? (
          <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Bookmark className="h-3.5 w-3.5 text-ink-2" aria-hidden="true" />
        )}
        <span>{t.saved.menu}</span>
        {fields.length > 0 && (
          <span className="rounded-full bg-raised px-1.5 text-[10px] font-semibold tabular-nums text-ink-2">
            {fields.length}
          </span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 text-ink-2 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-panel shadow-[0_12px_32px_rgba(28,38,31,0.18)] heat-legend-enter">
          {/* Save the site that is open right now */}
          <div className="flex items-center gap-3 border-b border-line bg-ground/60 p-3">
            <FieldGlyph field={current.field} className="h-11 w-11" />
            {currentSaved ? (
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-crop">
                  <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.saved.isSaved}
                </div>
                <div className="truncate text-sm text-ink">{currentSaved.name}</div>
              </div>
            ) : (
              <form onSubmit={handleSave} className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label htmlFor="saved-field-name" className="text-xs font-medium text-ink-2">
                  {current.field ? t.saved.saveField : t.saved.saveSite}
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="saved-field-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.saved.namePlaceholder}
                    maxLength={60}
                    autoFocus
                    className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1 text-sm text-ink placeholder:text-ink-3 focus:border-crop focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!name.trim()}
                    className="rounded-md bg-crop px-2.5 py-1 text-xs font-semibold text-ground hover:bg-crop/90 disabled:opacity-40 cursor-pointer"
                  >
                    {t.saved.saveBtn}
                  </button>
                </div>
              </form>
            )}
          </div>

          {fields.length === 0 ? (
            <p className="p-4 text-xs leading-relaxed text-ink-2">{t.saved.empty}</p>
          ) : (
            <ul className="max-h-[50vh] overflow-y-auto py-1">
              {fields.map((f) => {
                const active = f.id === currentSaved?.id;
                return (
                  <li key={f.id} className="group flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onLoad(f);
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer ${
                        active ? 'bg-crop/10' : 'hover:bg-raised'
                      }`}
                    >
                      <FieldGlyph field={f.field} />
                      <span className="min-w-0">
                        <span className={`block truncate text-sm ${active ? 'font-semibold text-crop' : 'text-ink'}`}>{f.name}</span>
                        <span className="block text-xs tabular-nums text-ink-3">{savedFieldMeta(f, t.saved.point)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(f.id)}
                      title={t.saved.remove}
                      aria-label={`${t.saved.remove}: ${f.name}`}
                      className="rounded-md p-1.5 text-ink-3 opacity-60 hover:bg-warn/10 hover:text-warn group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-line px-3 py-2 text-[11px] text-ink-3">{t.saved.localNote}</p>
        </div>
      )}
    </div>
  );
}
