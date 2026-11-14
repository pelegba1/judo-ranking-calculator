// The official ranking (ranking.get_list) as OfficialEntry rows, and the date each age-gender list was published.
import type { RawRankingRow, RawWrlHistory } from '../data/ijf-api';
import { parseBreakdownPage } from '../data/breakdown';
import { AGE_GENDERS, officialCategory, splitAgeGender, type AgeGender } from '../data/ids';
import { WEIGHTS } from '../engine/rules/categories';
import { mondayOfIsoWeek } from '../engine/dates';
import type { OfficialEntry } from '../engine/projection';
import type { CategoryKey } from '../engine/types';

/** Category keys in display order: sen m, sen f, jun m, jun f, cad m, cad f; weights light to heavy. */
export const CATEGORY_ORDER: CategoryKey[] = AGE_GENDERS.flatMap((ag) => {
  const { age, gender } = splitAgeGender(ag);
  return WEIGHTS[age][gender].map((w) => `${age}-${gender}${w}` as CategoryKey);
});
const ORDER = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));

/** Official rows we can map, sorted by category order, place, idPerson. Unknown id_age/id_weight pairs are dropped. */
export function toOfficialEntries(rows: RawRankingRow[]): OfficialEntry[] {
  const out: OfficialEntry[] = [];
  for (const r of rows) {
    const category = officialCategory(r.id_age, r.id_weight);
    if (!category) continue;
    out.push({ idPerson: Number(r.id_person), category, place: Number(r.place), points: Number(r.sum_points) });
  }
  return out.sort((a, b) => ORDER.get(a.category)! - ORDER.get(b.category)! || a.place - b.place || a.idPerson - b.idPerson);
}

/**
 * Latest version of the `age` list in a wrl_history: `world_ranking_<age>_<YYYY>_<WW>` is the list published on
 * the Monday of ISO week WW (checked: 20144 'world_ranking_sen_2026_45' = "Ranked on Nov 2, 2026").
 */
export function latestVersion(history: RawWrlHistory[], age: string): { date: string; points: number } | null {
  let best: { year: number; week: number; points: number } | null = null;
  for (const h of history ?? []) {
    const m = new RegExp(`^world_ranking_${age}_(\\d{4})_(\\d{1,2})$`).exec(String(h.version));
    if (!m) continue;
    const year = Number(m[1]);
    const week = Number(m[2]);
    if (!best || year > best.year || (year === best.year && week > best.week)) best = { year, week, points: Number(h.sum_points) };
  }
  return best && { date: mondayOfIsoWeek(best.year, best.week), points: best.points };
}

export interface OfficialDateSources {
  wrlHistory: (idPerson: number) => Promise<RawWrlHistory[]>;
  breakdownHtml: (idPerson: number) => Promise<string>;
  log?: (msg: string) => void;
}

/**
 * Official date of each age-gender list: the latest wrl_history version of each weight category's #1 athlete,
 * accepted when its points equal that athlete's current official points; otherwise the "Ranked on" date of the
 * athlete's breakdown page. The latest accepted date wins (a disagreement between weights is logged).
 * An age-gender with no accepted date is left out.
 */
export async function findOfficialDates(
  official: OfficialEntry[], src: OfficialDateSources,
): Promise<Partial<Record<AgeGender, string>>> {
  const log = src.log ?? (() => {});
  const out: Partial<Record<AgeGender, string>> = {};
  for (const ag of AGE_GENDERS) {
    const { age } = splitAgeGender(ag);
    const leaders = official.filter((o) => o.category.startsWith(`${ag}`) && o.place === 1);
    const dates = new Set<string>();
    for (const leader of leaders) {
      try {
        const v = latestVersion(await src.wrlHistory(leader.idPerson), age);
        if (v && Math.abs(v.points - leader.points) < 0.5) {
          dates.add(v.date);
          continue;
        }
        log(`official date ${ag}: wrl_history of ${leader.idPerson} does not match the current list, reading the breakdown page`);
        const page = parseBreakdownPage(await src.breakdownHtml(leader.idPerson));
        if (page.age === age) dates.add(page.rankedOn);
      } catch (e) {
        log(`official date ${ag}: ${leader.idPerson} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    const sorted = [...dates].sort();
    if (sorted.length > 1) log(`official date ${ag}: #1 athletes disagree (${sorted.join(', ')}); using the latest`);
    if (sorted.length) out[ag] = sorted[sorted.length - 1];
  }
  return out;
}
