// Validation: does the engine reproduce the official ranking on the official ranking date?
import { computeRanking, type RankingEntry } from '../engine/ranking';
import type { OfficialEntry } from '../engine/projection';
import type { OfficialPlace } from '../engine/rules/domestic';
import type { AgeGroup, AthleteResult, CategoryKey, CompetitionMeta } from '../engine/types';
import { AGE_GENDERS, splitAgeGender, type AgeGender } from '../data/ids';
import { addDays } from './util';

export const MAX_MISMATCHES = 200;

export interface Mismatch { idPerson: number; category: CategoryKey; official: number; engine: number }
export interface AgeValidation { checked: number; matched: number; mismatches: Mismatch[] }
export type Validation = Record<AgeGroup, AgeValidation>;

const AGES: AgeGroup[] = ['sen', 'jun', 'cad'];

/** Official entries keyed by "idPerson|category" -> place, for the domestic rule. */
export function officialPlaceLookup(official: OfficialEntry[]): OfficialPlace {
  const m = new Map(official.map((o) => [`${o.idPerson}|${o.category}`, o.place]));
  return (id, cat) => m.get(`${id}|${cat}`);
}

/**
 * The engine ranking of `view` on `date`, from the results of competitions that ended before `date` (the ones
 * the official list of that date includes).
 */
export function rankingAtOfficialDate(
  results: AthleteResult[], comps: Map<number, CompetitionMeta>, date: string, view: AgeGroup, officialPlace: OfficialPlace,
): Map<CategoryKey, RankingEntry[]> {
  const included = results.filter((r) => comps.get(r.competitionId)!.dateTo < date);
  return computeRanking(included, comps, date, view, officialPlace);
}

/** rankingAtOfficialDate, memoised per (view, date) over one set of results. */
export function engineAtDates(
  results: AthleteResult[], comps: Map<number, CompetitionMeta>, officialPlace: OfficialPlace,
): (view: AgeGroup, date: string) => Map<CategoryKey, Map<number, number>> {
  const cache = new Map<string, Map<CategoryKey, Map<number, number>>>();
  return (view, date) => {
    const key = `${view}|${date}`;
    let r = cache.get(key);
    if (!r) {
      const ranking = rankingAtOfficialDate(results, comps, date, view, officialPlace);
      r = new Map([...ranking].map(([cat, es]) => [cat, new Map(es.map((e) => [e.idPerson, e.points]))]));
      cache.set(key, r);
    }
    return r;
  };
}
export type EngineAtDate = ReturnType<typeof engineAtDates>;

const rowsOf = (official: OfficialEntry[], ag: AgeGender) => official.filter((o) => o.category.startsWith(ag));

/** Official rows of one age-gender compared with the engine on `date`, in official order. */
function compare(rows: OfficialEntry[], totals: Map<CategoryKey, Map<number, number>>) {
  let matched = 0;
  const mismatches: Mismatch[] = [];
  for (const o of rows) {
    const engine = totals.get(o.category)?.get(o.idPerson) ?? 0;
    if (Math.abs(engine - o.points) < 0.5) matched++;
    else mismatches.push({ idPerson: o.idPerson, category: o.category, official: o.points, engine });
  }
  return { checked: rows.length, matched, mismatches };
}

/**
 * ranking.get_list can be newer than wrl_history and the breakdown pages (seen 2026-11-14: history and pages said
 * 2026-11-02 while the list already held the results of 2026-11-07/08 events, i.e. the 2026-11-09 list). So for each
 * age-gender the official date is the Monday, from `base` (the wrl_history date) up to `today`, on which the engine
 * matches the most official totals; a tie keeps the earlier Monday.
 */
export function chooseOfficialDates(
  base: Record<AgeGender, string>, today: string, official: OfficialEntry[], engine: EngineAtDate,
  log: (msg: string) => void = () => {},
): Record<AgeGender, string> {
  const out = {} as Record<AgeGender, string>;
  for (const ag of AGE_GENDERS) {
    const { age } = splitAgeGender(ag);
    const rows = rowsOf(official, ag);
    let best = { date: base[ag], matched: -1 };
    const tried: string[] = [];
    for (let d = base[ag]; d <= today; d = addDays(d, 7)) {
      const { matched } = compare(rows, engine(age, d));
      tried.push(`${d}: ${matched}/${rows.length}`);
      if (matched > best.matched) best = { date: d, matched };
    }
    if (tried.length > 1) log(`official date ${ag}: ${tried.join(', ')} -> ${best.date}`);
    out[ag] = best.date;
  }
  return out;
}

export interface ValidationReport { validation: Validation; allMismatches: Record<AgeGroup, Mismatch[]> }

/**
 * For each age, compares every official athlete's points with the engine total for the same person and category
 * on that age-gender's official date (engine missing = 0). matched = |difference| < 0.5. `validation` lists the
 * first MAX_MISMATCHES mismatches in official order (category, then place); `allMismatches` has all of them.
 */
export function validate(
  official: OfficialEntry[], officialDates: Record<AgeGender, string>, engine: EngineAtDate,
): ValidationReport {
  const validation = {} as Validation;
  const allMismatches = {} as Record<AgeGroup, Mismatch[]>;
  for (const age of AGES) {
    const v: AgeValidation = { checked: 0, matched: 0, mismatches: [] };
    const all: Mismatch[] = [];
    for (const ag of AGE_GENDERS.filter((x) => x.startsWith(`${age}-`))) {
      const date = officialDates[ag];
      if (!date) throw new Error(`validate: no official date for ${ag}`);
      const r = compare(rowsOf(official, ag), engine(age, date));
      v.checked += r.checked;
      v.matched += r.matched;
      all.push(...r.mismatches);
    }
    v.mismatches = all.slice(0, MAX_MISMATCHES);
    validation[age] = v;
    allMismatches[age] = all;
  }
  return { validation, allMismatches };
}

/** One stdout line per age: match rate and the shape of the mismatches (most common differences). */
export function summarise({ validation, allMismatches }: ValidationReport): string[] {
  return AGES.map((age) => {
    const v = validation[age];
    const pct = v.checked ? ((100 * v.matched) / v.checked).toFixed(2) : 'n/a';
    const ms = allMismatches[age];
    if (!ms.length) return `${age}: ${v.matched}/${v.checked} matched = ${pct}%`;
    const missing = ms.filter((m) => m.engine === 0).length;
    const high = ms.filter((m) => m.engine > m.official).length;
    const diffs = new Map<number, number>();
    for (const m of ms) diffs.set(m.engine - m.official, (diffs.get(m.engine - m.official) ?? 0) + 1);
    const top = [...diffs].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8).map(([d, n]) => `${d > 0 ? '+' : ''}${d} x${n}`);
    return `${age}: ${v.matched}/${v.checked} matched = ${pct}% (engine missing ${missing}, high ${high}, low ${ms.length - high - missing}; `
      + `top engine-official differences: ${top.join(', ')})`;
  });
}
