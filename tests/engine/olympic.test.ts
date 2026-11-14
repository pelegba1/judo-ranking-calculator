import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allocateQuotas, olympicPoints, statusIn, type OlympicStatus, type QuotaEntry } from '../../src/engine/olympic';
import { CONTINENTAL_QUOTA, DIRECT_PER_CATEGORY, WINDOW } from '../../src/engine/rules/la28';
import type { AthleteResult, CategoryKey, CompetitionMeta, EventType, Gender, Person, Place } from '../../src/engine/types';

const noOfficial = () => undefined;

let nextId = 1;
function comp(eventType: EventType, dateFrom: string, hostCountry = ''): CompetitionMeta {
  const id = nextId++;
  return { id, code: `c${id}`, name: `C${id}`, dateFrom, dateTo: dateFrom, age: 'sen', eventType, hostCountry };
}
function res(c: CompetitionMeta, idPerson: number, place: Place, extra: Partial<AthleteResult> = {}): AthleteResult {
  return { competitionId: c.id, idPerson, gender: 'm', weight: '-60', place, wins: 1, country: 'ISR', categoryFinished: true, ...extra };
}
const mapOf = (cs: CompetitionMeta[]) => new Map(cs.map((c) => [c.id, c]));

describe('olympicPoints', () => {
  it('counts only competitions in the window: first year 50%, second year 100%', () => {
    const before = comp('grand_slam', '2026-06-13'); // Papeete-like: two days before the window
    const y1 = comp('grand_slam', '2026-09-11');
    const y2 = comp('grand_slam', '2027-09-10');
    const after = comp('grand_slam', '2028-06-17');
    const rs = [before, y1, y2, after].map((c) => res(c, 1, 1));
    const entry = olympicPoints(rs, mapOf([before, y1, y2, after]), '2028-07-01', noOfficial).get('sen-m-60')![0];
    expect(entry.points).toBe(500 + 1000);
    expect(entry.results.map((r) => r.result.competitionId)).toEqual([y1.id, y2.id]);
    expect(entry.results.map((r) => r.value)).toEqual([500, 1000]);
  });

  it('the year boundary is the Monday 52 weeks into the window', () => {
    const lastY1 = comp('grand_prix', '2027-06-12');
    const firstY2 = comp('grand_prix', '2027-06-14');
    const r = olympicPoints([res(lastY1, 1, 1), res(firstY2, 1, 1)], mapOf([lastY1, firstY2]), '2027-07-01', noOfficial)
      .get('sen-m-60')![0];
    expect(r.results.map((x) => x.value)).toEqual([350, 700]);
  });

  it('best 6 per year (WRL counting)', () => {
    const cs = Array.from({ length: 7 }, (_, i) => comp('grand_prix', `2026-0${7 + Math.floor(i / 3)}-1${i % 3}`));
    const rs = cs.map((c, i) => res(c, 1, i === 6 ? 7 : 1));
    const e = olympicPoints(rs, mapOf(cs), '2026-11-02', noOfficial).get('sen-m-60')![0];
    expect(e.points).toBe(6 * 350);
    expect(e.results.filter((r) => !r.counted).map((r) => r.value)).toEqual([91]);
  });

  it('keeps the domestic rule (only 2 host athletes score at a GP)', () => {
    const gp = comp('grand_prix', '2026-08-14', 'PER');
    const rs = [1, 2, 3].map((id) => res(gp, id, (id === 1 ? 1 : id === 2 ? 2 : 3) as Place, { country: 'PER' }));
    const ranking = olympicPoints(rs, mapOf([gp]), '2026-11-02', noOfficial).get('sen-m-60')!;
    expect(ranking.map((e) => [e.idPerson, e.points])).toEqual([[1, 350], [2, 245]]);
  });

  it('window constants', () => {
    expect(WINDOW).toEqual({ from: '2026-06-15', to: '2028-06-12' });
  });
});

// The Step 1 sample (docs/research/olympic-points.md): window competitions up to 2026-11-08, ijf.org page values
// (list of 2026-11-09) and competitor.wrl_current ogq_sum_points (lagging: list of 2026-10-12).
describe('olympicPoints reproduces the recorded official Olympic points', () => {
  type Row = [number, Gender, string, Place, number, string, number];
  interface Sample {
    competitions: CompetitionMeta[]; results: Record<string, Row[]>; officialPlaces: Record<string, number>;
    pageDate: string; page: { idPerson: number; category: CategoryKey; points: number }[];
    apiDate: string; api: { idPerson: number; category: CategoryKey; points: number }[];
  }
  let sample: Sample;
  let results: AthleteResult[];
  let comps: Map<number, CompetitionMeta>;
  const officialPlace = (id: number, cat: CategoryKey) => sample.officialPlaces[`${id}|${cat}`];
  const pointsOn = (date: string) => {
    const r = olympicPoints(results.filter((x) => comps.get(x.competitionId)!.dateTo < date), comps, date, officialPlace);
    return (id: number, cat: CategoryKey) => r.get(cat)?.find((e) => e.idPerson === id)?.points ?? 0;
  };
  beforeAll(() => {
    sample = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'olympic', 'sample.json'), 'utf8'));
    comps = mapOf(sample.competitions);
    results = Object.entries(sample.results).flatMap(([cid, rows]) => rows.map(([idPerson, gender, weight, place, wins, country, fin]) => (
      { competitionId: Number(cid), idPerson, gender, weight, place, wins, country, categoryFinished: fin === 1 })));
  });

  it('ijf.org page: all 48 (top 24 men + top 24 women)', () => {
    const at = pointsOn(sample.pageDate);
    const wrong = sample.page.filter((a) => at(a.idPerson, a.category) !== a.points);
    expect(sample.page).toHaveLength(48);
    expect(wrong).toEqual([]);
  });

  it('API sample: 737 of 743 (the 6 misses are known WRL gaps: participation points, a person merge)', () => {
    const at = pointsOn(sample.apiDate);
    const wrong = sample.api.filter((a) => at(a.idPerson, a.category) !== a.points).map((a) => a.idPerson).sort((x, y) => x - y);
    expect(sample.api).toHaveLength(743);
    expect(wrong).toEqual([13028, 14772, 20137, 31371, 45549, 102884]);
  });

  it('Aghayev (20144): 716 in the lagging API list, 1216 on the page (Abu Dhabi GS 1st = +500)', () => {
    expect(pointsOn(sample.apiDate)(20144, 'sen-m-60')).toBe(716);
    expect(pointsOn(sample.pageDate)(20144, 'sen-m-60')).toBe(1216);
  });
});

// ---------- allocateQuotas ----------

interface Spec { id: number; noc: string; continent?: string; points: number }
/** One category's ranking from athletes listed best first (places 1..n). */
function category(cat: CategoryKey, athletes: Spec[]): [CategoryKey, QuotaEntry[]] {
  return [cat, athletes.map((a, i) => ({ idPerson: a.id, category: cat, points: a.points, place: i + 1 }))];
}
function personsOf(...lists: Spec[][]): Record<number, Person> {
  const out: Record<number, Person> = {};
  for (const a of lists.flat()) out[a.id] = { id: a.id, name: `A${a.id}`, country: a.noc, continent: a.continent ?? 'Asia' };
  return out;
}
/** `n` athletes of distinct NOCs (prefix + index), ids from `idBase`, points descending from `top`. */
function field(n: number, idBase: number, nocPrefix: string, continent: string, top: number): Spec[] {
  return Array.from({ length: n }, (_, i) => ({ id: idBase + i, noc: `${nocPrefix}${i}`, continent, points: top - i * 10 }));
}
const kindOf = (m: Map<number, OlympicStatus>, id: number) => m.get(id)?.kind;
const NO_CONTINENTAL = { Africa: { m: 0, f: 0 }, Europe: { m: 0, f: 0 }, Asia: { m: 0, f: 0 }, Oceania: { m: 0, f: 0 }, Americas: { m: 0, f: 0 } };

describe('allocateQuotas: direct places (D.1.1)', () => {
  it('two FRA athletes at 3 and 5: the first is direct, the second blocked, and place 18 becomes direct', () => {
    const a = field(20, 100, 'N', 'Asia', 2000);
    a[2].noc = 'FRA';
    a[4].noc = 'FRA';
    const s = allocateQuotas(new Map([category('sen-m-60', a)]), personsOf(a), { continentalQuota: NO_CONTINENTAL });
    expect(s.get(a[2].id)).toEqual({ kind: 'direct', olympicPlace: 3, category: 'sen-m-60' });
    expect(s.get(a[4].id)).toEqual({ kind: 'noc_blocked', olympicPlace: 5, category: 'sen-m-60' });
    expect(kindOf(s, a[17].id)).toBe('direct');
    expect(kindOf(s, a[18].id)).toBe('out');
    expect([...s.values()].filter((x) => x.kind === 'direct')).toHaveLength(DIRECT_PER_CATEGORY);
  });

  it('a USA athlete in the top 17 is host and does not take a direct place; every USA athlete is host', () => {
    const a = field(25, 100, 'N', 'Americas', 2000);
    a[3].noc = 'USA';
    a[22].noc = 'USA';
    const s = allocateQuotas(new Map([category('sen-f-48', a)]), personsOf(a), { continentalQuota: NO_CONTINENTAL });
    expect(s.get(a[3].id)).toEqual({ kind: 'host', olympicPlace: 4, category: 'sen-f-48' });
    expect(kindOf(s, a[22].id)).toBe('host');
    expect(kindOf(s, a[17].id)).toBe('direct'); // place 18
    expect(kindOf(s, a[18].id)).toBe('out');
  });

  it('an athlete ranked in two categories: status in the first, out (and no place taken) in the other', () => {
    const a60 = field(20, 100, 'A', 'Asia', 2000);
    const a66 = field(20, 200, 'B', 'Asia', 2000);
    a66[1] = { ...a60[1] }; // athlete 101 is also 2nd at -66
    const s = allocateQuotas(new Map([category('sen-m-60', a60), category('sen-m-66', a66)]), personsOf(a60, a66), { continentalQuota: NO_CONTINENTAL });
    expect(s.get(101)).toEqual({ kind: 'direct', olympicPlace: 2, category: 'sen-m-60' });
    expect(statusIn(s, 101, 'sen-m-66', 2)).toEqual({ kind: 'out', olympicPlace: 2, category: 'sen-m-66' });
    expect(kindOf(s, a66[17].id)).toBe('direct'); // -66 place 18 moves up
  });

  it('the default continental quota is 52 + 52', () => {
    const total = (g: Gender) => Object.values(CONTINENTAL_QUOTA).reduce((t, q) => t + q[g], 0);
    expect([total('m'), total('f')]).toEqual([52, 52]);
  });
});

describe('allocateQuotas: continental places (D.1.2)', () => {
  // Two categories, each with 17 Asian direct qualifiers, then Europeans.
  const EUROPE_ONLY = { ...NO_CONTINENTAL, Europe: { m: 13, f: 13 } };
  function setup() {
    const menTop = field(17, 1000, 'AM', 'Asia', 5000);
    const womenTop = field(17, 2000, 'AW', 'Asia', 5000);
    const menEu = field(20, 3000, 'E', 'Europe', 1000); // NOCs E0..E19, points 1000..810
    const womenEu = field(20, 4000, 'E', 'Europe', 1005); // the same NOCs, 5 points more each
    return { menTop, womenTop, menEu, womenEu };
  }

  it('13 men + 13 women from the continental list, at most one per NOC across categories and genders', () => {
    const { menTop, womenTop, menEu, womenEu } = setup();
    const ranking = new Map([category('sen-m-60', [...menTop, ...menEu]), category('sen-f-48', [...womenTop, ...womenEu])]);
    const s = allocateQuotas(ranking, personsOf(menTop, womenTop, menEu, womenEu), { continentalQuota: EUROPE_ONLY });
    const cont = (list: Spec[]) => list.filter((a) => kindOf(s, a.id) === 'continental').map((a) => a.noc);
    // Combined list by points: E0 woman (1005), E0 man (1000), E1 woman (995), E1 man (990), ...
    // Each NOC is taken by its woman: 13 women E0..E12; the European men's places go to NOCs E13..E19 (7 of them).
    // Europe cannot use its other 6 men's places, so they go to the best remaining men worldwide, one per NOC per
    // category only: E0..E5. E6..E12 men stay out.
    expect(cont(womenEu)).toEqual(['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12']);
    expect(cont(menEu)).toEqual(['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E13', 'E14', 'E15', 'E16', 'E17', 'E18', 'E19']);
    expect(menEu.slice(6, 13).map((a) => kindOf(s, a.id))).toEqual(Array(7).fill('out'));
    expect(s.get(womenEu[0].id)).toEqual({ kind: 'continental', olympicPlace: 18, category: 'sen-f-48' });
  });

  it('without unused places, a NOC already holding a continental place gets no second one', () => {
    const { menTop, womenTop, menEu, womenEu } = setup();
    const ranking = new Map([category('sen-m-60', [...menTop, ...menEu]), category('sen-f-48', [...womenTop, ...womenEu])]);
    const s = allocateQuotas(ranking, personsOf(menTop, womenTop, menEu, womenEu), {
      continentalQuota: { ...NO_CONTINENTAL, Europe: { m: 7, f: 13 } },
    });
    const cont = (list: Spec[]) => list.filter((a) => kindOf(s, a.id) === 'continental').map((a) => a.noc);
    expect(cont(menEu)).toEqual(['E13', 'E14', 'E15', 'E16', 'E17', 'E18', 'E19']);
  });

  it('direct qualifiers and NOC-blocked athletes are not in the continental list; nor is a NOC already in that category', () => {
    const a = field(17, 100, 'N', 'Europe', 5000);
    a[5].noc = 'FRA'; // FRA direct at 6
    const blocked = { id: 500, noc: 'FRA', continent: 'Europe', points: 4400 }; // place 18 after a[16]? no: inserted at 8
    const fraLow = { id: 501, noc: 'FRA', continent: 'Europe', points: 100 };
    const ger = { id: 502, noc: 'GER', continent: 'Europe', points: 90 };
    const list = [...a.slice(0, 7), blocked, ...a.slice(7), fraLow, ger];
    const s = allocateQuotas(new Map([category('sen-m-66', list)]), personsOf(list), {
      continentalQuota: { ...NO_CONTINENTAL, Europe: { m: 2, f: 0 } },
    });
    expect(kindOf(s, 500)).toBe('noc_blocked');
    expect(kindOf(s, 501)).toBe('out'); // FRA already has a -66 athlete
    expect(kindOf(s, 502)).toBe('continental');
    expect([...s.values()].filter((x) => x.kind === 'direct')).toHaveLength(17);
  });

  it('persons without a continent are left out of the continental lists', () => {
    const top = field(17, 100, 'N', 'Asia', 5000);
    const unknown = { id: 600, noc: 'XYZ', continent: '', points: 900 };
    const other = { id: 601, noc: 'IJF', continent: 'Other', points: 850 };
    const asian = { id: 602, noc: 'KOR', continent: 'Asia', points: 800 };
    const list = [...top, unknown, other, asian];
    const s = allocateQuotas(new Map([category('sen-m-73', list)]), personsOf(list), {
      continentalQuota: { ...NO_CONTINENTAL, Asia: { m: 1, f: 0 } },
    });
    expect(kindOf(s, 600)).toBe('out');
    expect(kindOf(s, 601)).toBe('out');
    expect(kindOf(s, 602)).toBe('continental');
  });

  it('unused continental places go to the best remaining athletes of that gender worldwide, one per NOC per category', () => {
    const top60 = field(17, 100, 'A', 'Asia', 5000);
    const top66 = field(17, 200, 'B', 'Asia', 5000);
    const oce = { id: 300, noc: 'AUS', continent: 'Oceania', points: 50 }; // the only Oceania man: 3 places unused
    const eu1 = { id: 301, noc: 'GER', continent: 'Europe', points: 900 }; // -60
    const eu2 = { id: 302, noc: 'GER', continent: 'Europe', points: 880 }; // -60, same NOC and category: skipped
    const eu3 = { id: 303, noc: 'GER', continent: 'Europe', points: 870 }; // -66: allowed (one per NOC per category)
    const as1 = { id: 304, noc: 'KOR', continent: 'Asia', points: 860 }; // -66
    const as2 = { id: 305, noc: 'CHN', continent: 'Asia', points: 10 }; // -66
    const ranking = new Map([
      category('sen-m-60', [...top60, eu1, eu2, oce]),
      category('sen-m-66', [...top66, eu3, as1, as2]),
    ]);
    const s = allocateQuotas(ranking, personsOf(top60, top66, [oce, eu1, eu2, eu3, as1, as2]), {
      continentalQuota: { ...NO_CONTINENTAL, Oceania: { m: 4, f: 0 } },
    });
    expect(kindOf(s, 300)).toBe('continental');
    expect([301, 302, 303, 304, 305].map((id) => kindOf(s, id))).toEqual(['continental', 'out', 'continental', 'continental', 'out']);
  });

  it('equal points: the senior tie-break decides (world championship points first)', () => {
    const wc = comp('world_ch', '2026-10-04');
    const gs = comp('grand_slam', '2026-09-11');
    const mk = (c: CompetitionMeta, id: number, place: Place, gender: Gender, weight: string, country: string) =>
      res(c, id, place, { gender, weight, country });
    // 700 (WC 3rd x 50% = 500 ... ) - both end on 500: A = WC 3rd, B = GS 1st, in different categories
    const rs = [mk(wc, 1, 3, 'm', '-60', 'GER'), mk(gs, 2, 1, 'm', '-66', 'FRA')];
    const ranking = olympicPoints(rs, mapOf([wc, gs]), '2026-11-02', noOfficial);
    expect(ranking.get('sen-m-60')![0].points).toBe(ranking.get('sen-m-66')![0].points);
    // Neither is in a top 17 that is full, so make the direct places unavailable: 17 better athletes of other NOCs.
    const filled = new Map<CategoryKey, QuotaEntry[]>();
    const persons: Record<number, Person> = {
      1: { id: 1, name: 'A', country: 'GER', continent: 'Europe' }, 2: { id: 2, name: 'B', country: 'FRA', continent: 'Europe' },
    };
    for (const cat of ['sen-m-60', 'sen-m-66'] as CategoryKey[]) {
      const top = field(17, cat === 'sen-m-60' ? 100 : 200, `${cat}N`, 'Asia', 9000);
      for (const t of top) persons[t.id] = { id: t.id, name: '', country: t.noc, continent: 'Asia' };
      const own = ranking.get(cat)![0];
      filled.set(cat, [...category(cat, top)[1], { ...own, place: 18 }]);
    }
    const s = allocateQuotas(filled, persons, { continentalQuota: { ...NO_CONTINENTAL, Europe: { m: 1, f: 0 } } });
    expect(kindOf(s, 1)).toBe('continental');
    expect(kindOf(s, 2)).toBe('out');
  });
});
