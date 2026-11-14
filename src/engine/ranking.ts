import type { AgeGroup, AthleteResult, CategoryKey, CompetitionMeta } from './types';
import { categoryKey, scoreResults, type OfficialPlace, type ScoredResult } from './scoring';
import { compareTied } from './rules/counting';

export interface RankingEntry {
  idPerson: number;
  category: CategoryKey;
  points: number;
  place: number; // 1-based, consecutive
  results: ScoredResult[];
}

/**
 * The `view` world ranking on `rankingDate`, per category. Athletes with 0 points (and categories left empty) are left out.
 * Order: points, then the view's tie-breaks, then idPerson ascending.
 */
export function computeRanking(
  results: AthleteResult[], comps: Map<number, CompetitionMeta>, rankingDate: string,
  view: AgeGroup, officialPlace: OfficialPlace,
): Map<CategoryKey, RankingEntry[]> {
  const byCategory = new Map<CategoryKey, Map<number, ScoredResult[]>>();
  for (const s of scoreResults(results, comps, rankingDate, view, officialPlace)) {
    const cat = categoryKey(view, s.result);
    let athletes = byCategory.get(cat);
    if (!athletes) byCategory.set(cat, (athletes = new Map()));
    athletes.set(s.result.idPerson, [...(athletes.get(s.result.idPerson) ?? []), s]);
  }

  const ranking = new Map<CategoryKey, RankingEntry[]>();
  for (const [category, athletes] of byCategory) {
    const entries = [...athletes].map(([idPerson, rs]) => {
      const counted = rs.filter((r) => r.counted);
      return { idPerson, category, points: counted.reduce((s, r) => s + r.value, 0), place: 0, results: rs, counted };
    }).filter((e) => e.points > 0);
    entries.sort((a, b) => b.points - a.points || compareTied(view, a.counted, b.counted) || a.idPerson - b.idPerson);
    if (entries.length) ranking.set(category, entries.map(({ counted: _, ...e }, i) => ({ ...e, place: i + 1 })));
  }
  return ranking;
}
