import type { AgeGroup, AthleteResult, CategoryKey, CompetitionMeta, EventType, Gender } from './types';
import { basePoints } from './rules/points';
import { selectCounted, type Period } from './rules/counting';
import { decayDates } from './dates';

export interface ScoredResult {
  result: AthleteResult;
  /** The competition as seen by the ranking view (a junior WC in the senior view has eventType 'junior_world_ch'). */
  meta: CompetitionMeta;
  base: number;
  period: Period;
  value: number; // after domestic rule and 100/50/0%
  counted: boolean;
  halfDate: string;
  expireDate: string;
}

export type OfficialPlace = (id: number, cat: CategoryKey) => number | undefined;

export function categoryKey(age: AgeGroup, r: { gender: Gender; weight: string }): CategoryKey {
  return `${age}-${r.gender}${r.weight}`;
}

/** The competition as it enters the `view` ranking, or null when it gives no points there. */
function inView(meta: CompetitionMeta, view: AgeGroup): CompetitionMeta | null {
  if (meta.age === view) return meta;
  if (view === 'sen' && meta.age === 'jun' && meta.eventType === 'world_ch') {
    return { ...meta, age: 'sen', eventType: 'junior_world_ch' };
  }
  return null;
}

// Domestic rule (spec 5.1): only the best `n` host-country athletes score, counted per category or per gender
// across all categories of the competition. Keyed by the competition's own age group and event type.
interface DomesticQuota { per: 'category' | 'gender'; n: number; }
const PER_CATEGORY_2: DomesticQuota = { per: 'category', n: 2 };
const DOMESTIC_QUOTA: Record<AgeGroup, Partial<Record<EventType, DomesticQuota>>> = {
  sen: { grand_slam: PER_CATEGORY_2, grand_prix: PER_CATEGORY_2 },
  jun: { grand_prix: PER_CATEGORY_2, world_ch: { per: 'gender', n: 9 } },
  cad: { grand_prix: PER_CATEGORY_2, world_ch: { per: 'gender', n: 10 } },
};

/** Host-country results beyond the domestic quota (they score 0). */
function domesticExcluded(
  results: AthleteResult[], comps: Map<number, CompetitionMeta>, officialPlace: OfficialPlace,
): Set<AthleteResult> {
  const groups = new Map<string, { quota: DomesticQuota; meta: CompetitionMeta; hosts: AthleteResult[] }>();
  for (const r of results) {
    const meta = comps.get(r.competitionId)!;
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

function periodOf(rankingDate: string, half: string, expire: string): Period {
  if (rankingDate < half) return 'current';
  if (rankingDate < expire) return 'previous';
  return 'expired';
}

const FACTOR: Record<Period, number> = { current: 1, previous: 0.5, expired: 0 };

/**
 * Score every result that enters the `view` ranking: base points, domestic rule, decay, and which results count.
 * Results in unfinished categories are dropped. Output keeps the input order.
 */
export function scoreResults(
  results: AthleteResult[], comps: Map<number, CompetitionMeta>, rankingDate: string,
  view: AgeGroup, officialPlace: OfficialPlace,
): ScoredResult[] {
  const entering: { r: AthleteResult; original: CompetitionMeta; meta: CompetitionMeta }[] = [];
  for (const r of results) {
    if (!r.categoryFinished) continue;
    const original = comps.get(r.competitionId);
    if (!original) throw new Error(`scoreResults: no competition meta for id ${r.competitionId}`);
    const meta = inView(original, view);
    if (meta) entering.push({ r, original, meta });
  }

  const excluded = domesticExcluded(entering.map((e) => e.r), comps, officialPlace);

  const scored: ScoredResult[] = entering.map(({ r, original, meta }) => {
    const base = basePoints(meta.age, meta.eventType, r.place, r.wins, original.dateFrom);
    const { half, expire } = decayDates(original);
    const period = periodOf(rankingDate, half, expire);
    const value = excluded.has(r) ? 0 : base * FACTOR[period];
    return { result: r, meta, base, period, value, counted: false, halfDate: half, expireDate: expire };
  });

  const byAthlete = new Map<string, ScoredResult[]>();
  for (const s of scored) {
    const key = `${s.result.idPerson}|${categoryKey(view, s.result)}`;
    byAthlete.set(key, [...(byAthlete.get(key) ?? []), s]);
  }
  for (const group of byAthlete.values()) {
    for (const s of selectCounted(view, group)) s.counted = true;
  }
  return scored;
}
