// Pure formatting helpers for the tables (no React, so they are unit-tested).

export type MovementDir = 'up' | 'down' | 'same' | 'new';

/** Change of place against the official list: ▲3 (up), ▼2 (down), — (same), חדש (not in the official list). */
export function formatMovement(officialPlace: number | null, projectedPlace: number): { label: string; dir: MovementDir } {
  if (officialPlace === null) return { label: 'חדש', dir: 'new' };
  const d = officialPlace - projectedPlace;
  if (d > 0) return { label: `▲${d}`, dir: 'up' };
  if (d < 0) return { label: `▼${-d}`, dir: 'down' };
  return { label: '—', dir: 'same' };
}

/** 2026-11-16 -> 16.11.2026 */
export const formatDate = (d: string) => (d && d.length >= 10 ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : d);

/** A result's place in a competition (1, 2, 3, 5, 7, 9, 17 ...). */
export const placeLabel = (place: number) => String(place);

export const formatPoints = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** "+540" / "−235" (true minus sign); empty for no change. */
export const formatDelta = (n: number) => (n > 0 ? `+${formatPoints(n)}` : n < 0 ? `−${formatPoints(-n)}` : '');

/** The part of a projected entry that decides highlighting. */
export interface Affectable { delta: number; engine: { results: { result: { competitionId: number } }[] } | null }

/** Rows of athletes touched by the added competitions: a result from one of them, or a change in points. */
export function isAffected(e: Affectable, added: ReadonlySet<number>): boolean {
  if (e.delta !== 0) return true;
  return !!e.engine && added.size > 0 && e.engine.results.some((r) => added.has(r.result.competitionId));
}
