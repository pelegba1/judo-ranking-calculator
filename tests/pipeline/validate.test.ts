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
  const choose = (official: OfficialEntry[], today = '2026-11-14', history = base, previous: Partial<Record<AgeGender, string>> = {}) =>
    chooseOfficialDates({ history, previous, today, official, engine: engine(official) });
  const senM = (c: ReturnType<typeof choose>) => ({ date: c.dates['sen-m'], warnings: c.warnings.filter((w) => w.startsWith('sen-m')) });

  it('moves to a later Monday when the list already includes a later competition', () => {
    expect(senM(choose([off(10, 1400, 1), off(11, 490, 2)]))).toEqual({ date: '2026-11-09', warnings: [] });
  });

  it('keeps the history date when the later competition is not in the list', () => {
    expect(senM(choose([off(10, 700, 1), off(11, 490, 2)])).date).toBe('2026-11-02');
  });

  it('keeps the earlier Monday on a tie and never goes past today', () => {
    expect(senM(choose([off(11, 490, 1)])).date).toBe('2026-11-02');
    expect(senM(choose([off(10, 1400, 1)], '2026-11-08')).date).toBe('2026-11-02');
  });

  it('never goes back before the previously published date', () => {
    // the list matches 11-02 better (B not included), but 11-09 was already published: stay there
    const c = senM(choose([off(10, 700, 1), off(11, 490, 2)], '2026-11-14', base, { 'sen-m': '2026-11-09' }));
    expect(c.date).toBe('2026-11-09');
  });

  it('keeps the previous date and warns when the best match is below 90%', () => {
    const bad = [off(10, 5, 1), off(11, 5, 2)]; // nothing matches on any Monday
    expect(senM(choose(bad, '2026-11-14', base, { 'sen-m': '2026-11-02' }))).toEqual({
      date: '2026-11-02', warnings: [expect.stringMatching(/sen-m: best match 0.0% .* below 90%.* keeping 2026-11-02/)],
    });
    // nothing published yet: the history date, still warned
    const first = senM(choose(bad));
    expect(first.date).toBe('2026-11-02');
    expect(first.warnings).toHaveLength(1);
  });

  it('clamps a history date after today and snaps a non-Monday to its Monday, with a warning', () => {
    const official = [off(10, 1400, 1), off(11, 490, 2)];
    const future = senM(choose(official, '2026-11-14', { ...base, 'sen-m': '2026-11-23' }));
    expect(future.date).toBe('2026-11-09');
    expect(future.warnings).toEqual([expect.stringMatching(/sen-m: .*2026-11-23.* after today/)]);
    const tuesday = senM(choose(official, '2026-11-14', { ...base, 'sen-m': '2026-11-03' }));
    expect(tuesday.date).toBe('2026-11-09');
    expect(tuesday.warnings).toEqual([expect.stringMatching(/sen-m: .*2026-11-03.* not a Monday/)]);
  });

  it('warns when an age-gender has no official rows and keeps the previous date', () => {
    const c = choose([off(10, 1400, 1)], '2026-11-14', base, { 'cad-f': '2026-10-26' });
    expect(c.dates['cad-f']).toBe('2026-10-26');
    expect(c.warnings.some((w) => /^cad-f: no official rows/.test(w))).toBe(true);
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
