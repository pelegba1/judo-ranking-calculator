import type { CompetitionMeta, Gender } from '../types';
import type { DecayRule } from '../scoring';

// LA28 Olympic qualification (spec 5.2; docs/reference/JUD-LA28-Qualification-System.pdf). How the Olympic points
// are counted was found by reproducing the official list: docs/research/olympic-points.md.

/** Qualification window: competitions starting on or after `from`; the final list is the one of `to`. */
export const WINDOW = { from: '2026-06-15', to: '2028-06-12' };

/**
 * The window is 104 weeks (Mon 2026-06-15 .. Mon 2028-06-12). Results of competitions starting before the Monday
 * 52 weeks in count 50% (first year), from it on 100% (second year); best 6 of each year count, as in the WRL.
 * The 50% first year is verified (2026-11-14: all window results at 50%); the exact boundary is not (no second-year
 * result exists yet) — UNVERIFIED.
 */
export const FULL_VALUE_FROM = '2027-06-14';

/** D.1.1: the 17 highest-ranked athletes per category, at most one per NOC. */
export const DIRECT_PER_CATEGORY = 17;

/** D.2: the host NOC has one place in every category; its athletes never take a direct or continental place. */
export const HOST = 'USA';

export type Continent = 'Africa' | 'Europe' | 'Asia' | 'Oceania' | 'Americas';
export const CONTINENTS: Continent[] = ['Africa', 'Europe', 'Asia', 'Oceania', 'Americas'];

/** D.1.2: continental places per gender (52 + 52). */
export const CONTINENTAL_QUOTA: Record<Continent, Record<Gender, number>> = {
  Africa: { m: 12, f: 12 },
  Europe: { m: 13, f: 13 },
  Asia: { m: 12, f: 12 },
  Oceania: { m: 4, f: 4 },
  Americas: { m: 11, f: 11 },
};

/** Continent names as the IJF data spells them (persons.json); anything else ('', 'Other') has no continent. */
const CONTINENT_NAMES: Record<string, Continent> = {
  Africa: 'Africa', Europe: 'Europe', Asia: 'Asia', Oceania: 'Oceania', Panamerica: 'Americas', Americas: 'Americas',
};
export const continentOf = (name: string | undefined): Continent | null => CONTINENT_NAMES[name ?? ''] ?? null;

/** Whether a competition is inside the qualification window. */
export const inWindow = (c: Pick<CompetitionMeta, 'dateFrom'>) => c.dateFrom >= WINDOW.from && c.dateFrom <= WINDOW.to;

/** After the window every result is out of the list (the dates shown for a result). */
const AFTER_WINDOW = '2028-06-13';

/**
 * Olympic counterpart of the WRL decay: first-year results are in the 50% period ('previous'), second-year results
 * in the 100% period ('current'). The ranking date does not matter inside the window.
 */
export const OLYMPIC_DECAY: DecayRule = (c) => (c.dateFrom < FULL_VALUE_FROM
  ? { period: 'previous', half: c.dateFrom, expire: AFTER_WINDOW }
  : { period: 'current', half: AFTER_WINDOW, expire: AFTER_WINDOW });
