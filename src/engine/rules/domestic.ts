import type { AgeGroup, AthleteResult, CategoryKey, CompetitionMeta, EventType } from '../types';
import { categoryKey } from './categories';

export type OfficialPlace = (id: number, cat: CategoryKey) => number | undefined;

/** Best `n` host-country athletes score, counted per category or per gender across all categories. */
export interface DomesticQuota { per: 'category' | 'gender'; n: number; }

const PER_CATEGORY_2: DomesticQuota = { per: 'category', n: 2 };

/** Domestic rule (spec 5.1), keyed by the competition's own age group and event type. */
export const DOMESTIC_QUOTA: Record<AgeGroup, Partial<Record<EventType, DomesticQuota>>> = {
  sen: { grand_slam: PER_CATEGORY_2, grand_prix: PER_CATEGORY_2 },
  jun: { grand_prix: PER_CATEGORY_2, world_ch: { per: 'gender', n: 9 } },
  cad: { grand_prix: PER_CATEGORY_2, world_ch: { per: 'gender', n: 10 } },
};

/**
 * Host-country results beyond the domestic quota (they score 0). Best = lower place, then better official place
 * in the competition's own age category (undefined = worst), then lower idPerson.
 * `results` must hold every result of each competition, or the quota is applied to a partial field.
 */
export function domesticExcluded(
  results: AthleteResult[], comps: Map<number, CompetitionMeta>, officialPlace: OfficialPlace,
): Set<AthleteResult> {
  const groups = new Map<string, { quota: DomesticQuota; meta: CompetitionMeta; hosts: AthleteResult[] }>();
  for (const r of results) {
    const meta = comps.get(r.competitionId);
    if (!meta) throw new Error(`domesticExcluded: no competition meta for id ${r.competitionId}`);
    const quota = DOMESTIC_QUOTA[meta.age][meta.eventType];
    if (!quota || !meta.hostCountry || r.country !== meta.hostCountry) continue;
    const key = `${r.competitionId}|${quota.per === 'category' ? r.gender + r.weight : r.gender}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { quota, meta, hosts: [] }));
    g.hosts.push(r);
  }
  const excluded = new Set<AthleteResult>();
  for (const { quota, meta, hosts } of groups.values()) {
    const official = (r: AthleteResult) => officialPlace(r.idPerson, categoryKey(meta.age, r)) ?? Infinity;
    hosts
      .sort((a, b) => a.place - b.place || official(a) - official(b) || a.idPerson - b.idPerson)
      .slice(quota.n)
      .forEach((r) => excluded.add(r));
  }
  return excluded;
}
