import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBreakdownPage, type BreakdownRow } from '../../src/data/breakdown';
import { classifyCompetition } from '../../src/engine/rules/classify';
import type { AthleteResult, CompetitionMeta, Gender, Place } from '../../src/engine/types';

const PLACES: Record<string, Place> = {
  '1. place': 1, '2. place': 2, '3. place': 3, '5. place': 5, '7. place': 7,
  '1/16': 9, '1/32': 17, '1/64': 33, participation: 33,
};

/**
 * Test adapter: turns an official breakdown page into AthleteResult + CompetitionMeta pairs.
 * wins = 0 for 'participation', else 1; hostCountry '' (no domestic filter); dateFrom = dateTo = row date.
 * Competition ids are synthetic (idBase + row index).
 */
export function breakdownToResults(
  fixtureId: number, gender: Gender, weight: string, idBase = 1000,
): { rows: BreakdownRow[]; results: AthleteResult[]; comps: Map<number, CompetitionMeta> } {
  const html = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'breakdown', `${fixtureId}.html`), 'utf8');
  const { rows } = parseBreakdownPage(html);
  const results: AthleteResult[] = [];
  const comps = new Map<number, CompetitionMeta>();
  rows.forEach((row, i) => {
    const code = row.competitionCode!;
    const cls = classifyCompetition(code, row.competitionName);
    if (!cls) throw new Error(`Unclassified fixture competition ${code}`);
    const place = PLACES[row.placeLabel];
    if (place === undefined) throw new Error(`Unknown place label ${row.placeLabel}`);
    const id = idBase + i;
    comps.set(id, {
      id, code, name: row.competitionName, dateFrom: row.date, dateTo: row.date,
      age: cls.age, eventType: cls.eventType, hostCountry: '',
    });
    results.push({
      competitionId: id, idPerson: fixtureId, gender, weight, place,
      wins: row.placeLabel === 'participation' ? 0 : 1, country: 'XXX', categoryFinished: true,
    });
  });
  return { rows, results, comps };
}
