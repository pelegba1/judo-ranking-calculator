// LA28 Olympic ranking (spec 5.2): Olympic points and the quota places they give.
import type { AthleteResult, CategoryKey, CompetitionMeta, Gender, Person } from './types';
import { computeRanking, type RankingEntry } from './ranking';
import type { OfficialEntry } from './projection';
import type { OfficialPlace } from './rules/domestic';
import { compareTied } from './rules/counting';
import {
  CONTINENTAL_QUOTA, CONTINENTS, DIRECT_PER_CATEGORY, HOST, OLYMPIC_DECAY, continentOf, inWindow, type Continent,
} from './rules/la28';

/**
 * The Olympic ranking on `rankingDate`: the senior world ranking over the competitions of the qualification window,
 * with the Olympic split into a 50% first year and a 100% second year (rules/la28.ts). Like computeRanking, the
 * caller decides which competitions are in (the ones that ended before the list date); every result of a window
 * competition must be supplied (domestic rule).
 */
export function olympicPoints(
  results: AthleteResult[], comps: Map<number, CompetitionMeta>, rankingDate: string, officialPlace: OfficialPlace = () => undefined,
): Map<CategoryKey, RankingEntry[]> {
  const inside = results.filter((r) => {
    const c = comps.get(r.competitionId);
    return !c || inWindow(c); // an unknown competition is left to computeRanking, which throws
  });
  return computeRanking(inside, comps, rankingDate, 'sen', officialPlace, OLYMPIC_DECAY);
}

/**
 * The official Olympic list covers only the athletes the nightly run asked the IJF about. For everyone else the
 * engine's own total on the official date stands in (the "official + delta" projection then keeps it; such athletes
 * are not verified against the IJF).
 */
export function completeOfficial(
  official: readonly OfficialEntry[], engineOnOfficialDate: Map<CategoryKey, RankingEntry[]>,
): OfficialEntry[] {
  const asked = new Set(official.map((o) => o.idPerson));
  const out: OfficialEntry[] = [...official];
  for (const entries of engineOnOfficialDate.values()) {
    for (const e of entries) {
      if (!asked.has(e.idPerson)) out.push({ idPerson: e.idPerson, category: e.category, place: e.place, points: e.points });
    }
  }
  return out;
}

/** The status of an athlete's entry in `category`: their status if it belongs to that category, else `out`. */
export function statusIn(statuses: Map<number, OlympicStatus>, idPerson: number, category: CategoryKey, place: number): OlympicStatus {
  const s = statuses.get(idPerson);
  return s && s.category === category ? s : { kind: 'out', olympicPlace: place, category };
}

export type OlympicStatusKind = 'direct' | 'continental' | 'host' | 'noc_blocked' | 'out';
/**
 * `olympicPlace`: the athlete's place in the Olympic ranking of `category`, the category the status belongs to (an
 * athlete ranked in two categories is `out` in the other one).
 */
export interface OlympicStatus { kind: OlympicStatusKind; olympicPlace: number; category: CategoryKey }

/** A ranking entry as the allocation sees it; `results` (counted ones) feed the tie-break across categories. */
export type QuotaEntry = Pick<RankingEntry, 'idPerson' | 'category' | 'points' | 'place'> & Partial<Pick<RankingEntry, 'results'>>;

export interface QuotaOptions {
  /** Continental places per continent and gender (default CONTINENTAL_QUOTA). */
  continentalQuota?: Record<Continent, Record<Gender, number>>;
}

const genderOf = (cat: CategoryKey) => cat[4] as Gender;

/**
 * Quota places from an Olympic ranking (spec 5.2), per athlete id:
 * 1. Direct (D.1.1): in each category, going down the places, the first 17 athletes with at most one per NOC are
 *    `direct`; an athlete whose NOC already has a better one in the top 17 is `noc_blocked` (the NOC chooses; the
 *    place goes to the next athlete). Host NOC athletes are `host` wherever they are ranked and take no place.
 * 2. Continental (D.1.2): per continent, all other athletes of all categories and both genders by points; each
 *    gets a place while their gender's quota lasts, at most one per NOC across all categories and genders, and
 *    never a second athlete of a NOC in a category. Athletes without a known continent are left out.
 * 3. Unused continental places go to the best remaining athletes of that gender worldwide, at most one per NOC
 *    per category.
 * Equal points across categories: the senior tie-break on the counted results, then the place, then the id.
 * Everyone else is `out`. An athlete ranked in two categories keeps the status of the first category (in `ranking`
 * order) where they are direct, blocked or host, and takes no place in the other one.
 *
 * Status per (athlete, category): see statusIn.
 */
export function allocateQuotas(
  ranking: Map<CategoryKey, readonly QuotaEntry[]>, persons: Record<number, Person> | ReadonlyMap<number, Person>,
  options: QuotaOptions = {},
): Map<number, OlympicStatus> {
  const quota = options.continentalQuota ?? CONTINENTAL_QUOTA;
  const person = (id: number) => (persons instanceof Map ? persons.get(id) : (persons as Record<number, Person>)[id]);
  /** An unknown NOC never blocks anyone: give it a key of its own. */
  const nocOf = (id: number) => person(id)?.country || `?${id}`;

  const status = new Map<number, OlympicStatus>();
  const set = (e: QuotaEntry, kind: OlympicStatusKind) => {
    const cur = status.get(e.idPerson);
    if (!cur || cur.kind === 'out') status.set(e.idPerson, { kind, olympicPlace: e.place, category: e.category });
  };
  const nocInCategory = new Set<string>(); // `${noc}|${category}` with a qualified (or NOC-choosing) athlete
  const remaining: QuotaEntry[] = [];

  // 1. direct
  for (const [cat, entries] of ranking) {
    let direct = 0;
    for (const e of [...entries].sort((a, b) => a.place - b.place)) {
      const noc = nocOf(e.idPerson);
      if (status.has(e.idPerson)) continue; // qualified (or host) in another category: takes no place here
      if (noc === HOST) set(e, 'host');
      else if (direct < DIRECT_PER_CATEGORY && nocInCategory.has(`${noc}|${cat}`)) set(e, 'noc_blocked');
      else if (direct < DIRECT_PER_CATEGORY) {
        set(e, 'direct');
        nocInCategory.add(`${noc}|${cat}`);
        direct++;
      } else remaining.push(e);
    }
  }

  const counted = (e: QuotaEntry) => (e.results ?? []).filter((r) => r.counted);
  const best = (a: QuotaEntry, b: QuotaEntry) =>
    b.points - a.points || compareTied('sen', counted(a), counted(b)) || a.place - b.place || a.idPerson - b.idPerson;
  const open = (e: QuotaEntry) => !status.has(e.idPerson) && !nocInCategory.has(`${nocOf(e.idPerson)}|${e.category}`);
  const take = (e: QuotaEntry) => {
    set(e, 'continental');
    nocInCategory.add(`${nocOf(e.idPerson)}|${e.category}`);
  };

  // 2. continental
  const unused: Record<Gender, number> = { m: 0, f: 0 };
  for (const continent of CONTINENTS) {
    const left = { ...quota[continent] };
    const nocUsed = new Set<string>();
    for (const e of remaining.filter((x) => continentOf(person(x.idPerson)?.continent) === continent).sort(best)) {
      const g = genderOf(e.category);
      const noc = nocOf(e.idPerson);
      if (left[g] <= 0 || nocUsed.has(noc) || !open(e)) continue;
      take(e);
      nocUsed.add(noc);
      left[g]--;
    }
    unused.m += left.m;
    unused.f += left.f;
  }

  // 3. unused continental places, worldwide
  for (const e of [...remaining].sort(best)) {
    const g = genderOf(e.category);
    if (unused[g] <= 0 || !open(e)) continue;
    take(e);
    unused[g]--;
  }

  for (const e of remaining) set(e, 'out');
  return status;
}
