import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseOlympicPage, reviveDevalue } from '../../src/data/olympic-page';
import {
  olympicCandidates, olympicStep, statusOfCode, toOlympicEntries, type OlympicOfficialFile,
} from '../../src/pipeline/olympic';
import type { RawWrlCurrent } from '../../src/data/ijf-api';
import type { AthleteResult, CategoryKey, CompetitionMeta, Gender, Person, Place } from '../../src/engine/types';
import type { RankingEntry } from '../../src/engine/ranking';

const FIX = join(import.meta.dirname, '..', 'fixtures', 'olympic');

describe('ijf.org Olympic page', () => {
  it('revives devalue references, wrappers and shared nodes', () => {
    const nodes = [['ShallowReactive', 1], { a: 2, b: 3, c: 2 }, [4, 5], 'x', 7, ['Set', 6], 8, 'y'];
    // node 2 is an array [node4, node5] = [7, Set(8)]; shared by a and c
    const v = reviveDevalue(nodes) as { a: unknown[]; b: string; c: unknown[] };
    expect(v.b).toBe('x');
    expect(v.a).toEqual([7, [8]]);
    expect(v.a).toBe(v.c);
  });

  it('parses the server-rendered top 24 (men, 2026-11-14)', () => {
    const rows = parseOlympicPage(readFileSync(join(FIX, 'page-m.html'), 'utf8'));
    expect(rows).toHaveLength(24);
    expect(rows[0]).toEqual({ idPerson: 39933, category: 'sen-m-100', points: 1850, place: 1, status: 1 });
    expect(rows.find((r) => r.idPerson === 20144)).toEqual({ idPerson: 20144, category: 'sen-m-60', points: 1216, place: 2, status: 3 });
    expect(rows.find((r) => r.idPerson === 47189)?.status).toBe(4); // YONEZUKA USA: host nation
  });

  it('throws when the page has no payload or no Olympic list', () => {
    expect(() => parseOlympicPage('<html></html>')).toThrow(/no __NUXT_DATA__/);
    expect(() => parseOlympicPage('<script id="__NUXT_DATA__" type="application/json">[{"x":1},2]</script>')).toThrow(/no Olympic ranking list/);
  });
});

describe('competitor.wrl_current rows', () => {
  it('maps q_status codes', () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(statusOfCode)).toEqual(['out', 'direct', 'continental', 'noc_blocked', 'host', 'other', 'other']);
    expect(statusOfCode(null)).toBe('out');
  });

  it('keeps senior rows with their category; no Olympic points = 0', () => {
    const rows: RawWrlCurrent[] = [
      { points: '5473', place: '1', id_weight: '1', age: 'Seniors', weight: '-60', ogq_place: '6', ogq_sum_points: '716', q_status: '3' },
      { points: '886', place: '48', id_weight: '12', age: 'Seniors', weight: '-70', ogq_place: null, ogq_sum_points: null, q_status: null },
      { points: '300', place: '5', id_weight: '44', age: 'Juniors', weight: '-60' },
    ];
    expect(toOlympicEntries(20144, rows)).toEqual([
      { idPerson: 20144, category: 'sen-m-60', points: 716, place: 6, status: 'noc_blocked', qStatus: 3 },
      { idPerson: 20144, category: 'sen-f-70', points: 0, place: null, status: 'out', qStatus: null },
    ]);
  });
});

const entry = (idPerson: number, category: `sen-${string}`, points: number, place: number): RankingEntry =>
  ({ idPerson, category: category as RankingEntry['category'], points, place, results: [] });

describe('olympicCandidates', () => {
  it('top N per category plus top N per continent and gender', () => {
    const ranking = new Map<CategoryKey, RankingEntry[]>([
      ['sen-m-60', [entry(1, 'sen-m-60', 900, 1), entry(2, 'sen-m-60', 800, 2), entry(3, 'sen-m-60', 10, 3)]],
      ['sen-m-66', [entry(4, 'sen-m-66', 700, 1), entry(5, 'sen-m-66', 20, 2)]],
    ]);
    const persons = new Map<number, Person>([
      [1, { id: 1, name: '', country: 'FRA', continent: 'Europe' }], [2, { id: 2, name: '', country: 'GER', continent: 'Europe' }],
      [3, { id: 3, name: '', country: 'FIJ', continent: 'Oceania' }], [4, { id: 4, name: '', country: 'JPN', continent: 'Asia' }],
      [5, { id: 5, name: '', country: 'TGA', continent: 'Oceania' }],
    ]);
    // 1 per category: 1, 4; 1 per continent and gender: Europe 1, Oceania 5 (20 > 10), Asia 4
    expect(olympicCandidates(ranking, persons, 1, 1)).toEqual([1, 4, 5]);
  });
});

describe('olympicStep', () => {
  // Two window competitions: a GS on 2026-09-11 (list of 2026-09-14 on), a GP on 2026-10-30 (list of 2026-11-02 on).
  const gs: CompetitionMeta = { id: 1, code: 'gs', name: 'GS', dateFrom: '2026-09-11', dateTo: '2026-09-13', age: 'sen', eventType: 'grand_slam', hostCountry: '' };
  const gp: CompetitionMeta = { id: 2, code: 'gp', name: 'GP', dateFrom: '2026-10-30', dateTo: '2026-11-01', age: 'sen', eventType: 'grand_prix', hostCountry: '' };
  const comps = new Map([[1, gs], [2, gp]]);
  const r = (c: CompetitionMeta, idPerson: number, place: Place, gender: Gender = 'm'): AthleteResult =>
    ({ competitionId: c.id, idPerson, gender, weight: gender === 'm' ? '-60' : '-48', place, wins: 1, country: `N${idPerson}`, categoryFinished: true });
  const results = [r(gs, 1, 1), r(gs, 2, 2), r(gp, 2, 1), r(gs, 3, 1, 'f')];
  const persons = new Map<number, Person>([1, 2, 3].map((id) => [id, { id, name: '', country: `N${id}`, continent: 'Europe' }]));
  // The API's Olympic list is the 2026-10-12 one: the GP is not in it.
  const api: Record<number, RawWrlCurrent[]> = {
    1: [{ points: '1', place: '1', id_weight: '1', age: 'Seniors', weight: '-60', ogq_place: '1', ogq_sum_points: '500', q_status: '1' }],
    2: [{ points: '1', place: '2', id_weight: '1', age: 'Seniors', weight: '-60', ogq_place: '2', ogq_sum_points: '350', q_status: '1' }],
    3: [{ points: '1', place: '1', id_weight: '8', age: 'Seniors', weight: '-48', ogq_place: '1', ogq_sum_points: '500', q_status: '1' }],
  };
  const base = {
    results, comps, officialPlace: () => undefined, persons, today: '2026-11-14', previous: null, retryDelayMs: 0,
    pageHtml: async () => readFileSync(join(FIX, 'page-m.html'), 'utf8'),
  };

  it('dates the official list by the best engine match, validates totals and statuses', async () => {
    const out = await olympicStep({ ...base, wrlCurrent: async (id) => api[id] });
    expect(out.file.date).toBe('2026-09-14'); // first Monday with all three matched (searched from 12 weeks back)
    expect(out.file.entries.map((e) => [e.idPerson, e.points])).toEqual([[3, 500], [1, 500], [2, 350]]);
    expect(out.validation).toMatchObject({ asked: 3, fetched: 3, checked: 3, matched: 3 });
    expect(out.validation.status).toMatchObject({ checked: 3, agreed: 3 });
    expect(out.validation.page.checked).toBe(48); // the men's fixture page, served for both genders
    expect(out.warnings).toEqual([]);
  });

  it('never dates the list before the previous run', async () => {
    const previous: OlympicOfficialFile = { date: '2026-11-02', entries: [{ idPerson: 1, category: 'sen-m-60', points: 1, place: 1, status: 'direct', qStatus: 1 }] };
    const out = await olympicStep({ ...base, previous, wrlCurrent: async (id) => api[id] });
    // on 2026-11-02 the GP is in: athlete 2 has 350 + 350 = 700 against 350 official -> 2/3 below 90%: keep
    expect(out.file.date).toBe('2026-11-02');
    expect(out.warnings[0]).toMatch(/best match 66\.7%.*keeping 2026-11-02/);
  });

  it('keeps the previous file when too many calls fail', async () => {
    const previous: OlympicOfficialFile = { date: '2026-10-12', entries: [{ idPerson: 1, category: 'sen-m-60', points: 500, place: 1, status: 'direct', qStatus: 1 }] };
    const out = await olympicStep({ ...base, previous, wrlCurrent: async (id) => { if (id !== 1) throw new Error('down'); return api[id]; } });
    expect(out.file).toBe(previous);
    expect(out.warnings[0]).toMatch(/answered for 1\/3 athletes; keeping the previous/);
  });
});
