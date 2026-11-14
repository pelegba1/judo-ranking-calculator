// Loads one competition from the IJF API into engine results. Shared by the nightly pipeline and the browser.
import {
  getCompetitors, getContests, getResults,
  type RawCompetitorsResponse, type RawContest, type RawResultsResponse,
} from './ijf-api';
import { derivePlacings } from '../engine/placings';
import { classifyCompetition } from '../engine/rules/classify';
import type { AthleteResult, CompetitionMeta, Person } from '../engine/types';

/** API dates come as '2026/11/13' (get_list) or '2026-10-29' (info); both become '2026-11-13'. */
export function normaliseDate(d: string): string {
  return String(d ?? '').slice(0, 10).replace(/\//g, '-');
}

/** Competition fields shared by competition.get_list and competition.info rows. */
export interface RawCompetitionLike {
  id_competition: string | number;
  competition_code: string;
  name: string;
  date_from: string;
  date_to: string;
  country_short?: string;
}

/** CompetitionMeta for a raw list/info row, or null when the competition gives no ranking points. */
export function toCompetitionMeta(raw: RawCompetitionLike): CompetitionMeta | null {
  const cls = classifyCompetition(raw.competition_code ?? '', raw.name ?? '');
  if (!cls) return null;
  return {
    id: Number(raw.id_competition), code: raw.competition_code, name: raw.name,
    dateFrom: normaliseDate(raw.date_from), dateTo: normaliseDate(raw.date_to),
    age: cls.age, eventType: cls.eventType, hostCountry: raw.country_short ?? '',
  };
}

const fullName = (family: unknown, given: unknown) =>
  [family, given].filter((s) => typeof s === 'string' && s.trim()).map((s) => (s as string).trim()).join(' ');

/**
 * Persons of one competition: name and country from the entries, continent from the results payload (it carries
 * `continent` for places 1-7; other athletes get it through their country, when someone of that country placed).
 */
export function extractPersons(
  contests: RawContest[], competitors: RawCompetitorsResponse, results: RawResultsResponse,
): Person[] {
  const persons = new Map<number, Person>();
  const continentOf = new Map<string, string>();
  const put = (id: unknown, name: string, country: unknown) => {
    const n = Number(id);
    if (!n) return;
    const p = persons.get(n);
    if (!p) persons.set(n, { id: n, name, country: String(country ?? ''), continent: '' });
    else {
      if (!p.name && name) p.name = name;
      if (!p.country && country) p.country = String(country);
    }
  };
  for (const ageGroup of Object.values(competitors?.categories ?? {})) {
    for (const group of Object.values(ageGroup)) {
      for (const p of Object.values(group.persons ?? {})) put(p.id_person, fullName(p.family_name, p.given_name), p.country_short);
    }
  }
  for (const ageGroup of Object.values(results?.by_categories ?? {})) {
    for (const group of Object.values(ageGroup)) {
      for (const p of group.persons ?? []) {
        put(p.id_person, fullName(p.family_name, p.given_name), p.country_short);
        if (p.continent && p.country_short) continentOf.set(p.country_short, String(p.continent));
      }
    }
  }
  for (const c of contests) {
    put(c.id_person_white, fullName(c.family_name_white, c.given_name_white), c.country_short_white);
    put(c.id_person_blue, fullName(c.family_name_blue, c.given_name_blue), c.country_short_blue);
  }
  for (const p of persons.values()) p.continent = continentOf.get(p.country) ?? '';
  return [...persons.values()];
}

/** Fetch contests, competitors and results of a competition and derive every athlete's result. */
export async function loadCompetition(meta: CompetitionMeta): Promise<{ results: AthleteResult[]; persons: Person[] }> {
  const [contests, competitors, results] = await Promise.all([
    getContests(meta.id), getCompetitors(meta.id), getResults(meta.id),
  ]);
  return {
    results: derivePlacings(meta, contests, competitors, results),
    persons: extractPersons(contests, competitors, results),
  };
}
