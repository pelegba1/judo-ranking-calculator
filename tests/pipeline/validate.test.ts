import { describe, it, expect } from 'vitest';
import { chooseOfficialDates, engineAtDates, officialPlaceLookup, validate } from '../../src/pipeline/validate';
import type { AgeGender } from '../../src/data/ids';
import type { OfficialEntry } from '../../src/engine/projection';
import type { AthleteResult, CompetitionMeta, Place } from '../../src/engine/types';

const gp = (id: number, dateFrom: string, dateTo: string): CompetitionMeta => ({
  id, code: `gp_x${id}`, name: `GP ${id}`, dateFrom, dateTo, age: 'sen', eventType: 'grand_prix', hostCountry: '',
});
const res = (c: CompetitionMeta, idPerson: number, place: Place): AthleteResult => ({
  competitionId: c.id, idPerson, gender: 'm', weight: '-60', place, wins: 3, country: 'ISR', categoryFinished: true,
});
const A = gp(1, '2026-10-17', '2026-10-18');
const B = gp(2, '2026-11-07', '2026-11-08'); // ends between the Nov 2 and Nov 9 lists
const comps = new Map([A, B].map((c) => [c.id, c]));
const results = [res(A, 10, 1), res(B, 10, 1), res(A, 11, 2)];
const base = Object.fromEntries((['sen-m', 'sen-f', 'jun-m', 'jun-f', 'cad-m', 'cad-f'] as AgeGender[])
  .map((ag) => [ag, '2026-11-02'])) as Record<AgeGender, string>;
const off = (idPerson: number, points: number, place: number): OfficialEntry => ({ idPerson, category: 'sen-m-60', place, points });

describe('chooseOfficialDates', () => {
  const engine = (official: OfficialEntry[]) => engineAtDates(results, comps, officialPlaceLookup(official));

  it('moves to a later Monday when the list already includes a later competition', () => {
    const official = [off(10, 1400, 1), off(11, 490, 2)];
    expect(chooseOfficialDates(base, '2026-11-14', official, engine(official))['sen-m']).toBe('2026-11-09');
  });

  it('keeps the history date when the later competition is not in the list', () => {
    const official = [off(10, 700, 1), off(11, 490, 2)];
    expect(chooseOfficialDates(base, '2026-11-14', official, engine(official))['sen-m']).toBe('2026-11-02');
  });

  it('keeps the earlier Monday on a tie and never goes past today', () => {
    const official = [off(11, 490, 1)]; // same total on both Mondays
    const e = engine(official);
    expect(chooseOfficialDates(base, '2026-11-14', official, e)['sen-m']).toBe('2026-11-02');
    expect(chooseOfficialDates(base, '2026-11-08', [off(10, 1400, 1)], engine([off(10, 1400, 1)]))['sen-m']).toBe('2026-11-02');
  });
});

describe('validate', () => {
  it('counts matches per age and lists mismatches in official order', () => {
    const official = [off(10, 1400, 1), off(11, 400, 2), off(12, 50, 3)];
    const dates = { ...base, 'sen-m': '2026-11-09' };
    const { validation, allMismatches } = validate(official, dates, engineAtDates(results, comps, officialPlaceLookup(official)));
    expect(validation.sen).toEqual({
      checked: 3, matched: 1,
      mismatches: [
        { idPerson: 11, category: 'sen-m-60', official: 400, engine: 490 },
        { idPerson: 12, category: 'sen-m-60', official: 50, engine: 0 },
      ],
    });
    expect(validation.jun).toEqual({ checked: 0, matched: 0, mismatches: [] });
    expect(allMismatches.sen).toHaveLength(2);
  });
});
