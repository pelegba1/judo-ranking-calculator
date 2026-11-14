import { describe, it, expect } from 'vitest';
import { formatHash, parseHash, toOlympic, viewFiles, withView, type ProjectionData } from '../../src/web/state/useScenario';
import { buildOlympic, buildOlympicMemo } from '../../src/web/state/olympic';
import type { OlympicOfficialFile } from '../../src/pipeline/olympic';
import type { AgeGender } from '../../src/data/ids';
import type { AthleteResult, CompetitionMeta, Person, Place } from '../../src/engine/types';

const dates = (d: string): Record<AgeGender, string> =>
  ({ 'sen-m': d, 'sen-f': d, 'jun-m': d, 'jun-f': d, 'cad-m': d, 'cad-f': d });

describe('Olympic route', () => {
  it('parses and formats #/olympic/<g>/<weight> with the scenario params', () => {
    const h = parseHash('#/olympic/f/-57?add=3159&date=2026-11-16');
    expect(h).toEqual({ age: 'sen', gender: 'f', weight: '-57', added: [3159], date: '2026-11-16', olympic: true });
    expect(formatHash(h)).toBe('#/olympic/f/-57?add=3159&date=2026-11-16');
    expect(formatHash(parseHash('#/olympic/m/%2B100'))).toBe('#/olympic/m/%2B100');
    expect(parseHash('#/olympic/m/-99').weight).toBe('-60');
  });

  it('switching to another age group leaves the Olympic screen; toOlympic maps the weight to seniors', () => {
    const comps = new Map<number, CompetitionMeta>();
    expect(withView(parseHash('#/olympic/m/-73'), { age: 'jun' }, comps).olympic).toBeUndefined();
    expect(withView(parseHash('#/olympic/m/-73'), { gender: 'f' }, comps)).toMatchObject({ olympic: true, gender: 'f', weight: '-57' });
    expect(toOlympic(parseHash('#/cad/f/-70/athlete/5'), comps)).toEqual({
      age: 'sen', gender: 'f', weight: '-70', added: [], date: null, olympic: true,
    });
  });

  it('viewFiles returns the same merged objects for the same files', () => {
    const own = { official: [], results: {} };
    const jun = { official: [], results: {} };
    expect(viewFiles('sen', own, jun)).toEqual(viewFiles('sen', own, jun));
    expect(viewFiles('sen', own, jun).results).toBe(viewFiles('sen', own, jun).results);
    expect(viewFiles('cad', own, jun)).toBe(own);
  });
});

describe('buildOlympic', () => {
  const gs: CompetitionMeta = { id: 1, code: 'gs', name: 'GS', dateFrom: '2026-09-11', dateTo: '2026-09-13', age: 'sen', eventType: 'grand_slam', hostCountry: '' };
  const wc: CompetitionMeta = { id: 2, code: 'wc', name: 'WC', dateFrom: '2026-10-04', dateTo: '2026-10-10', age: 'sen', eventType: 'world_ch', hostCountry: '' };
  const gp: CompetitionMeta = { id: 3, code: 'gp', name: 'GP', dateFrom: '2026-11-13', dateTo: '2026-11-15', age: 'sen', eventType: 'grand_prix', hostCountry: '' };
  const r = (c: CompetitionMeta, idPerson: number, place: Place, country: string): AthleteResult =>
    ({ competitionId: c.id, idPerson, gender: 'm', weight: '-60', place, wins: 1, country, categoryFinished: true });
  const persons = new Map<number, Person>([
    [1, { id: 1, name: 'A', country: 'FRA', continent: 'Europe' }],
    [2, { id: 2, name: 'B', country: 'USA', continent: 'Panamerica' }],
    [3, { id: 3, name: 'C', country: 'XXX', continent: '' }],
  ]);
  const data: ProjectionData = {
    officialDates: dates('2026-11-09'), comps: new Map([[1, gs], [2, wc], [3, gp]]), official: [], live: {},
    results: { 1: [r(gs, 1, 1, 'FRA'), r(gs, 2, 2, 'USA')], 2: [r(wc, 1, 3, 'FRA'), r(wc, 3, 5, 'XXX')], 3: [r(gp, 3, 1, 'XXX')] },
  };
  // the official Olympic list is the 2026-09-14 one (before the WC): athlete 3 was not asked
  const file: OlympicOfficialFile = {
    date: '2026-09-14',
    entries: [
      { idPerson: 1, category: 'sen-m-60', points: 500, place: 1, status: 'direct', qStatus: 1 },
      { idPerson: 2, category: 'sen-m-60', points: 350, place: 2, status: 'host', qStatus: 4 },
    ],
  };

  it('official Olympic points + (engine after - engine before); WRL-included events count, added ones on top', () => {
    const base = buildOlympic(data, file, persons, { age: 'sen', gender: 'm', weight: '-60', added: [], targetDate: '2026-11-09' });
    const rows = base.byCategory.get('sen-m-60')!;
    // 1: 500 + WC 3rd (500) = 1000; 3: not asked -> engine 0 on 2026-09-14, + WC 5th 360 = 360, unverified; 2: 350
    expect(rows.map((x) => [x.idPerson, x.projectedPoints, x.verified, x.status.kind, x.officialStatus])).toEqual([
      [1, 1000, true, 'direct', 'direct'], [3, 360, false, 'direct', null], [2, 350, true, 'host', 'host'],
    ]);
    expect(base.officialDate).toBe('2026-09-14');
    expect(base.noContinent.m).toBe(0); // athlete 3 has no continent but is direct
  });

  it('an added competition moves the projection', () => {
    const v = buildOlympic(data, file, persons, { age: 'sen', gender: 'm', weight: '-60', added: [3], targetDate: '2026-11-16' });
    expect(v.byPerson.get(3)!.projectedPoints).toBe(360 + 350);
  });

  it('memoises per scenario', () => {
    const s = { age: 'sen' as const, gender: 'm' as const, weight: '-60', added: [], targetDate: '2026-11-09' };
    expect(buildOlympicMemo(data, file, persons, s)).toBe(buildOlympicMemo(data, file, persons, { ...s, gender: 'f' }));
    expect(buildOlympicMemo(data, file, persons, s)).not.toBe(buildOlympicMemo(data, file, persons, { ...s, added: [3] }));
  });
});
