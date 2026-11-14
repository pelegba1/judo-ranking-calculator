import type { AgeGroup, AthleteResult, CompetitionMeta } from './types';
import { basePoints } from './rules/points';
import { selectCounted } from './rules/counting';
import { PERIOD_FACTOR, periodOf, type Period } from './rules/decay';
import { domesticExcluded, type OfficialPlace } from './rules/domestic';
import { categoryKey } from './rules/categories';
import { competitionInView, resultHasViewCategory } from './rules/views';
import { decayDates } from './dates';

export { categoryKey } from './rules/categories';
export type { OfficialPlace } from './rules/domestic';

/**
 * The period (100% / 50% / expired) of a result on `rankingDate`, from its competition as stored (not as seen by
 * the view), with the dates shown for it. The world ranking decays by competition anniversary (WRL_DECAY); the
 * Olympic ranking splits its qualification window into two years instead (rules/la28.ts).
 */
export type DecayRule = (competition: CompetitionMeta, rankingDate: string) => { period: Period; half: string; expire: string };

/** World ranking decay: 100% for a year, 50% in the second year, then expired (spec 5.1). */
export const WRL_DECAY: DecayRule = (competition, rankingDate) => {
  const { half, expire } = decayDates(competition);
  return { period: periodOf(rankingDate, half, expire), half, expire };
};

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

/**
 * Score every result that enters the `view` ranking: base points, domestic rule, decay (`decay`, by default the
 * world ranking's), and which results count.
 * Results in unfinished categories are dropped, as are results carried in from another age group whose weight
 * has no category in `view`. Output keeps the input order.
 * All results of a competition must be supplied together: the domestic rule ranks the host athletes against
 * each other, so a partial field gives wrong exclusions.
 */
export function scoreResults(
  results: AthleteResult[], comps: Map<number, CompetitionMeta>, rankingDate: string,
  view: AgeGroup, officialPlace: OfficialPlace, decay: DecayRule = WRL_DECAY,
): ScoredResult[] {
  const entering: { r: AthleteResult; original: CompetitionMeta; meta: CompetitionMeta }[] = [];
  for (const r of results) {
    if (!r.categoryFinished) continue;
    const original = comps.get(r.competitionId);
    if (!original) throw new Error(`scoreResults: no competition meta for id ${r.competitionId}`);
    const meta = competitionInView(original, view);
    if (meta) entering.push({ r, original, meta });
  }

  // Domestic quotas are taken over the whole competition, before results without a view category are dropped.
  const excluded = domesticExcluded(entering.map((e) => e.r), comps, officialPlace);

  const scored: ScoredResult[] = entering
    .filter(({ r, original }) => resultHasViewCategory(r, original.age, view))
    .map(({ r, original, meta }) => {
      const base = basePoints(meta.age, meta.eventType, r.place, r.wins, original.dateFrom);
      const { period, half, expire } = decay(original, rankingDate);
      const value = excluded.has(r) ? 0 : base * PERIOD_FACTOR[period];
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
