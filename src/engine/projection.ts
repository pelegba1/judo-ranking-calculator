import type { CategoryKey } from './types';
import type { RankingEntry } from './ranking';

export interface OfficialEntry { idPerson: number; category: CategoryKey; place: number; points: number; }
export interface ProjectedEntry {
  idPerson: number; category: CategoryKey;
  officialPlace: number | null; officialPoints: number;
  projectedPoints: number; projectedPlace: number; delta: number;
  verified: boolean; engine: RankingEntry | null;
}

const pointsOf = (entries: Map<number, RankingEntry> | undefined, id: number) => entries?.get(id)?.points ?? 0;

/**
 * Displayed points = official points + (engine after - engine before). An engine entry that is missing counts as 0
 * (the engine omits 0-point athletes). `verified` means the engine reproduces the official total (within 0.5).
 * Ties in projected points keep the `after` engine order; athletes absent from `after` follow, by official place then id.
 */
export function project(
  official: OfficialEntry[], before: Map<CategoryKey, RankingEntry[]>, after: Map<CategoryKey, RankingEntry[]>,
): Map<CategoryKey, ProjectedEntry[]> {
  const officialBy = new Map<CategoryKey, Map<number, OfficialEntry>>();
  for (const o of official) {
    let m = officialBy.get(o.category);
    if (!m) officialBy.set(o.category, (m = new Map()));
    m.set(o.idPerson, o);
  }
  const index = (m: Map<CategoryKey, RankingEntry[]>, cat: CategoryKey) =>
    new Map((m.get(cat) ?? []).map((e) => [e.idPerson, e] as const));

  const out = new Map<CategoryKey, ProjectedEntry[]>();
  const categories = new Set<CategoryKey>([...officialBy.keys(), ...after.keys()]);
  for (const cat of categories) {
    const off = officialBy.get(cat) ?? new Map<number, OfficialEntry>();
    const b = index(before, cat);
    const a = index(after, cat);
    const ids = new Set<number>([...off.keys(), ...a.keys()]);
    const entries = [...ids].map((id) => {
      const o = off.get(id);
      const officialPoints = o?.points ?? 0;
      const bp = pointsOf(b, id);
      const ap = pointsOf(a, id);
      return {
        idPerson: id, category: cat,
        officialPlace: o?.place ?? null, officialPoints,
        projectedPoints: officialPoints + (ap - bp), projectedPlace: 0, delta: ap - bp,
        verified: Math.abs(bp - officialPoints) < 0.5, engine: a.get(id) ?? null,
      } satisfies ProjectedEntry;
    });
    entries.sort((x, y) =>
      y.projectedPoints - x.projectedPoints
      || (x.engine?.place ?? Infinity) - (y.engine?.place ?? Infinity)
      || (x.officialPlace ?? Infinity) - (y.officialPlace ?? Infinity)
      || x.idPerson - y.idPerson);
    entries.forEach((e, i) => { e.projectedPlace = i + 1; });
    out.set(cat, entries);
  }
  return out;
}
