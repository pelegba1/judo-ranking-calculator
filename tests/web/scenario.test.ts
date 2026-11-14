import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addCompetitionToHash, buildProjection, competitionProgress, defaultTargetDate, formatHash, mondayAfter, parseHash, pendingCompetitions,
  resolveScenario, withView, type ProjectionData, type ScenarioHash,
} from '../../src/web/state/useScenario';
import { derivePlacings } from '../../src/engine/placings';
import { toCompetitionMeta } from '../../src/data/competition-loader';
import { toOfficialEntries } from '../../src/pipeline/official';
import type { AgeGender } from '../../src/data/ids';
import type { AthleteResult, CategoryKey, CompetitionMeta } from '../../src/engine/types';
import type { ProjectedEntry } from '../../src/engine/projection';

const FIX = join(import.meta.dirname, '..', 'fixtures');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const comp = (id: number, over: Partial<CompetitionMeta> = {}): CompetitionMeta => ({
  id, code: `c${id}`, name: `C ${id}`, dateFrom: '2026-11-01', dateTo: '2026-11-02', age: 'sen', eventType: 'grand_prix',
  hostCountry: 'XXX', ...over,
});
const dates = (d: string): Record<AgeGender, string> =>
  ({ 'sen-m': d, 'sen-f': d, 'jun-m': d, 'jun-f': d, 'cad-m': d, 'cad-f': d });

describe('hash', () => {
  it('parses the brief example', () => {
    expect(parseHash('#/sen/m/-60?add=3159,3169&date=2026-11-16')).toEqual<ScenarioHash>({
      age: 'sen', gender: 'm', weight: '-60', added: [3159, 3169], date: '2026-11-16',
    });
  });

  it('formats the brief example', () => {
    expect(formatHash({ age: 'sen', gender: 'm', weight: '-60', added: [3159, 3169], date: '2026-11-16' }))
      .toBe('#/sen/m/-60?add=3159,3169&date=2026-11-16');
    expect(formatHash({ age: 'jun', gender: 'f', weight: '-48', added: [], date: null })).toBe('#/jun/f/-48');
  });

  it('a + weight survives a round trip, encoded or not', () => {
    const h = formatHash({ age: 'sen', gender: 'm', weight: '+100', added: [], date: null });
    expect(h).toBe('#/sen/m/%2B100');
    expect(parseHash(h).weight).toBe('+100');
    expect(parseHash('#/sen/m/+100').weight).toBe('+100');
    expect(parseHash('#/cad/f/%2b70').weight).toBe('+70');
  });

  it('tolerates junk: defaults, bad ids and dates dropped, duplicates removed', () => {
    expect(parseHash('')).toEqual({ age: 'sen', gender: 'm', weight: '-60', added: [], date: null });
    expect(parseHash('#/xxx/q/abc?add=12,foo,-3,12,,0,7.5&date=2026-13-45')).toEqual({
      age: 'sen', gender: 'm', weight: '-60', added: [12], date: null,
    });
    expect(parseHash('#/cad/f/-99?date=2026-02-30').weight).toBe('-40');
    expect(parseHash('#/cad/f/-99?date=2026-02-30').date).toBeNull();
    expect(parseHash('#/jun/f/%E0%A4%A').weight).toBe('-48'); // malformed escape
    expect(parseHash('#/jun/f/-57?date=2026-02-28&add=5').date).toBe('2026-02-28');
  });
});

describe('target date', () => {
  it('Monday after the dateTo', () => {
    expect(mondayAfter('2026-11-15')).toBe('2026-11-16'); // Sunday
    expect(mondayAfter('2026-11-14')).toBe('2026-11-16'); // Saturday
    expect(mondayAfter('2026-11-16')).toBe('2026-11-23'); // Monday -> next Monday
    expect(mondayAfter('2026-12-31')).toBe('2027-01-04');
  });

  it('event ending Sun 15.11.2026 -> 2026-11-16; latest added wins; nothing added -> official date', () => {
    const od = dates('2026-11-09');
    expect(defaultTargetDate([comp(1, { dateTo: '2026-11-15' })], od, 'sen')).toBe('2026-11-16');
    expect(defaultTargetDate([comp(1, { dateTo: '2026-11-22' }), comp(2, { dateTo: '2026-11-15' })], od, 'sen')).toBe('2026-11-23');
    expect(defaultTargetDate([], od, 'sen')).toBe('2026-11-09');
    expect(defaultTargetDate([], { ...od, 'sen-f': '2026-11-02' }, 'sen')).toBe('2026-11-09');
  });

  it('resolveScenario uses the explicit date, else the default from the added competitions of the view', () => {
    const comps = new Map([[1, comp(1, { dateTo: '2026-11-15' })], [2, comp(2, { age: 'cad', dateTo: '2026-11-29' })]]);
    const base: ScenarioHash = { age: 'sen', gender: 'm', weight: '-60', added: [1, 2], date: null };
    expect(resolveScenario(base, comps, dates('2026-11-09'))).toMatchObject({ targetDate: '2026-11-16', dateIsAuto: true });
    expect(resolveScenario({ ...base, date: '2026-12-07' }, comps, dates('2026-11-09')))
      .toMatchObject({ targetDate: '2026-12-07', dateIsAuto: false });
  });
});

describe('pendingCompetitions', () => {
  const meta = {
    officialDates: { ...dates('2026-11-09'), 'sen-f': '2026-11-02' },
    competitions: [
      { ...comp(1, { dateTo: '2026-11-01' }), hasResults: true }, // before both dates
      { ...comp(2, { dateTo: '2026-11-03' }), hasResults: true }, // pending for women only
      { ...comp(3, { dateTo: '2026-11-15' }), hasResults: true },
      { ...comp(4, { dateTo: '2026-11-22' }), hasResults: false }, // no results yet
      { ...comp(5, { age: 'cad', dateTo: '2026-11-15' }), hasResults: true },
      { ...comp(6, { age: 'jun', eventType: 'world_ch', dateTo: '2026-11-21' }), hasResults: true },
      { ...comp(7, { age: 'jun', eventType: 'continental_cup', dateTo: '2026-11-21' }), hasResults: true },
    ],
  };
  it('senior view: own age with results and not yet in the official list (either gender), plus junior worlds; newest first', () => {
    expect(pendingCompetitions(meta, 'sen').map((c) => c.id)).toEqual([6, 3, 2]);
  });
  it('junior view: junior events only', () => {
    expect(pendingCompetitions(meta, 'jun').map((c) => c.id)).toEqual([7, 6]); // same date: higher id first
  });
});

describe('competitionProgress', () => {
  const r = (gender: 'm' | 'f', weight: string, categoryFinished: boolean): AthleteResult =>
    ({ competitionId: 1, idPerson: 1, gender, weight, place: 1, wins: 1, country: 'X', categoryFinished });
  it('counts finished categories', () => {
    expect(competitionProgress([r('m', '-60', true), r('m', '-60', true), r('m', '-66', false), r('f', '-48', true)]))
      .toEqual({ finished: 2, total: 3 });
    expect(competitionProgress([])).toEqual({ finished: 0, total: 0 });
  });
});

describe('buildProjection (fixtures)', () => {
  const DIRS: Record<number, string> = { 3151: '3151', 3157: '3157', 3159: 'partial-3159' };
  let comps: Map<number, CompetitionMeta>;
  let results: Record<string, AthleteResult[]>;
  let official: ReturnType<typeof toOfficialEntries>;
  let finished3159: Set<CategoryKey>;
  let all3159: Set<CategoryKey>;

  beforeAll(() => {
    comps = new Map();
    results = {};
    for (const [id, dir] of Object.entries(DIRS)) {
      const d = (f: string) => read(join(FIX, 'competitions', dir, `${f}.json`));
      const meta = toCompetitionMeta(d('info'))!;
      comps.set(meta.id, meta);
      results[id] = derivePlacings(meta, d('contests').contests, d('competitors'), d('results'));
    }
    official = toOfficialEntries(read(join(FIX, 'ranking.json')).feed).filter((o) => o.category.startsWith('sen-'));
    finished3159 = new Set(results['3159'].filter((r) => r.categoryFinished).map((r) => `sen-${r.gender}${r.weight}` as CategoryKey));
    all3159 = new Set(results['3159'].map((r) => `sen-${r.gender}${r.weight}` as CategoryKey));
  });

  const data = (officialDates: Record<AgeGender, string>, live: Record<string, AthleteResult[]> = {}): ProjectionData =>
    ({ officialDates, comps, official, results, live });
  const scenario = (added: number[], targetDate: string) =>
    ({ age: 'sen' as const, gender: 'm' as const, weight: '-60', added, targetDate });
  const changed = (a: Map<CategoryKey, ProjectedEntry[]>, b: Map<CategoryKey, ProjectedEntry[]>) => {
    const out = new Set<CategoryKey>();
    for (const cat of new Set([...a.keys(), ...b.keys()])) {
      const pa = new Map((a.get(cat) ?? []).map((e) => [e.idPerson, e.projectedPoints]));
      const pb = new Map((b.get(cat) ?? []).map((e) => [e.idPerson, e.projectedPoints]));
      for (const id of new Set([...pa.keys(), ...pb.keys()])) if ((pa.get(id) ?? 0) !== (pb.get(id) ?? 0)) out.add(cat);
    }
    return out;
  };

  it('fixture sanity: 3159 is partial', () => {
    expect(finished3159.size).toBeGreaterThan(0);
    expect(finished3159.size).toBeLessThan(all3159.size);
  });

  it('nothing added on the official date: projected = official, delta 0, both genders', () => {
    const out = buildProjection(data(dates('2026-11-09')), scenario([], '2026-11-09'));
    expect([...out.keys()].some((k) => k.startsWith('sen-f'))).toBe(true);
    expect([...out.keys()].every((k) => k.startsWith('sen-'))).toBe(true);
    for (const es of out.values()) for (const e of es) expect(e.delta).toBe(0);
    const a = out.get('sen-m-60')!.find((e) => e.idPerson === 20144)!;
    expect(a.projectedPoints).toBe(5473);
    expect(a.officialPlace).toBe(1);
  });

  it('adding partial-3159 changes only categories whose Final finished, and every one of them', () => {
    const d = data(dates('2026-11-09'));
    const without = buildProjection(d, scenario([], '2026-11-16'));
    const withIt = buildProjection(d, scenario([3159], '2026-11-16'));
    const ch = changed(without, withIt);
    expect([...ch].sort()).toEqual([...finished3159].sort());
  });

  it('live results take precedence over the nightly ones for an added competition', () => {
    const live = { 3159: results['3159'].map((r) => ({ ...r, categoryFinished: r.gender === 'm' && r.weight === '-60' })) };
    const without = buildProjection(data(dates('2026-11-09')), scenario([], '2026-11-16'));
    const withLive = buildProjection(data(dates('2026-11-09'), live), scenario([3159], '2026-11-16'));
    expect([...changed(without, withLive)]).toEqual(['sen-m-60']);
  });

  it('official dates are per gender: an added competition already in one gender\'s list changes only the other', () => {
    const od = { ...dates('2026-11-09'), 'sen-f': '2026-10-26' }; // gs_uae2026 (Oct 29-31) not yet in the women's list
    const without = buildProjection(data(od), scenario([], '2026-11-09'));
    const withIt = buildProjection(data(od), scenario([3157], '2026-11-09'));
    const ch = [...changed(without, withIt)];
    expect(ch.length).toBeGreaterThan(0);
    expect(ch.every((k) => k.startsWith('sen-f'))).toBe(true);
  });

  it('ignores unknown and other-age added ids', () => {
    const d = data(dates('2026-11-09'));
    const base = buildProjection(d, scenario([], '2026-11-16'));
    const odd = buildProjection(d, scenario([424242], '2026-11-16'));
    expect(changed(base, odd).size).toBe(0);
  });
});

describe('addCompetitionToHash', () => {
  const od = dates('2026-11-09');
  const zagreb = comp(3159, { dateTo: '2026-11-15' });
  const comps = new Map<number, CompetitionMeta>([[3159, zagreb], [3169, comp(3169, { dateTo: '2026-11-15' })]]);

  it('applies to the hash it is given: a newer weight, date and toggles are kept', () => {
    // the user changed the view while the competition was being looked up
    const latest: ScenarioHash = { age: 'sen', gender: 'f', weight: '-57', added: [3169], date: '2026-12-07' };
    expect(addCompetitionToHash(latest, zagreb, comps, od)).toEqual({
      outcome: 'added', switched: false,
      next: { age: 'sen', gender: 'f', weight: '-57', added: [3169, 3159], date: '2026-12-07' },
    });
  });

  it('another age group: switches the view and keeps the competitions that still apply', () => {
    const cad = comp(3317, { age: 'cad', dateTo: '2026-11-14' });
    const h: ScenarioHash = { age: 'sen', gender: 'f', weight: '-57', added: [3159], date: null };
    expect(addCompetitionToHash(h, cad, new Map([...comps, [3317, cad]]), od)).toEqual({
      outcome: 'added', switched: true,
      next: { age: 'cad', gender: 'f', weight: '-57', added: [3317], date: null },
    });
  });

  it('already added / already in the official list', () => {
    const h: ScenarioHash = { age: 'sen', gender: 'm', weight: '-60', added: [3159], date: null };
    expect(addCompetitionToHash(h, zagreb, comps, od)).toMatchObject({ outcome: 'already_added', next: h });
    const old = comp(3100, { dateTo: '2026-11-08' });
    expect(addCompetitionToHash(h, old, comps, od)).toEqual({ outcome: 'already_official', switched: false, next: null });
  });
});

describe('athlete route in the hash', () => {
  it('parses and formats #/sen/m/-60/athlete/20144?add=3159', () => {
    const h = parseHash('#/sen/m/-60/athlete/20144?add=3159&date=2026-11-16');
    expect(h).toEqual({ age: 'sen', gender: 'm', weight: '-60', added: [3159], date: '2026-11-16', athlete: 20144 });
    expect(formatHash(h)).toBe('#/sen/m/-60/athlete/20144?add=3159&date=2026-11-16');
  });
  it('no athlete: unchanged format', () => {
    expect(formatHash(parseHash('#/sen/m/-60'))).toBe('#/sen/m/-60');
    expect(parseHash('#/sen/m/-60').athlete).toBeUndefined();
  });
  it('junk athlete ids fall back to the table', () => {
    for (const bad of ['abc', '0', '-5', '1.5', '99999999999999999999', '']) {
      expect(parseHash(`#/sen/m/-60/athlete/${bad}`).athlete).toBeUndefined();
    }
    expect(parseHash('#/sen/m/-60/foo/20144').athlete).toBeUndefined();
  });
  it('works with an encoded weight', () => {
    const h = parseHash('#/sen/m/%2B100/athlete/7');
    expect(h.weight).toBe('+100');
    expect(h.athlete).toBe(7);
    expect(formatHash(h)).toBe('#/sen/m/%2B100/athlete/7');
  });
  it('switching the view leaves the athlete', () => {
    const h = parseHash('#/sen/m/-60/athlete/7');
    expect(withView(h, { gender: 'f' }, new Map()).athlete).toBeUndefined();
  });
});
