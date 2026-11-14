import { describe, it, expect } from 'vitest';
import { computeRanking } from '../../src/engine/ranking';
import { scoreResults, type ScoredResult } from '../../src/engine/scoring';
import type { AthleteResult, CompetitionMeta, EventType, AgeGroup, Place } from '../../src/engine/types';
import { breakdownToResults } from '../helpers/breakdown-to-results';

const noOfficial = () => undefined;
const sum = (xs: ScoredResult[]) => xs.reduce((s, x) => s + x.value, 0);
const counted = (xs: ScoredResult[], period: ScoredResult['period']) =>
  xs.filter((x) => x.counted && x.period === period);

let nextId = 1;
function comp(eventType: EventType, dateFrom: string, age: AgeGroup = 'sen', hostCountry = ''): CompetitionMeta {
  const id = nextId++;
  return { id, code: `c${id}`, name: `C${id}`, dateFrom, dateTo: dateFrom, age, eventType, hostCountry };
}
function res(c: CompetitionMeta, idPerson: number, place: Place, extra: Partial<AthleteResult> = {}): AthleteResult {
  return {
    competitionId: c.id, idPerson, gender: 'm', weight: '-60', place, wins: 1, country: 'ISR',
    categoryFinished: true, ...extra,
  };
}
const mapOf = (cs: CompetitionMeta[]) => new Map(cs.map((c) => [c.id, c]));

describe('fixture truths (official breakdown pages)', () => {
  it('20144 seniors -60 on 2026-11-02 = 5473 (4308 + 1165)', () => {
    const { results, comps } = breakdownToResults(20144, 'm', '-60');
    const entry = computeRanking(results, comps, '2026-11-02', 'sen', noOfficial).get('sen-m-60')![0];
    expect(entry.idPerson).toBe(20144);
    expect(entry.points).toBe(5473);
    expect(sum(counted(entry.results, 'current'))).toBe(4308);
    expect(sum(counted(entry.results, 'previous'))).toBe(1165);
    const euro2023 = entry.results.find((r) => r.meta.code === 'eju_sen2023')!;
    expect(euro2023).toMatchObject({ value: 0, period: 'expired', counted: false });
  });

  it('20144: each counted value matches the official row', () => {
    const { rows, results, comps } = breakdownToResults(20144, 'm', '-60');
    const scored = scoreResults(results, comps, '2026-11-02', 'sen', noOfficial);
    expect(scored.map((s) => s.value)).toEqual(rows.map((r) => r.points));
  });

  it('97658 cadets -50 on 2026-10-26 = 1110', () => {
    const { rows, results, comps } = breakdownToResults(97658, 'm', '-50');
    const entry = computeRanking(results, comps, '2026-10-26', 'cad', noOfficial).get('cad-m-50')![0];
    expect(entry.points).toBe(1110);
    expect(entry.results.every((r) => r.counted)).toBe(true);
    const scored = scoreResults(results, comps, '2026-10-26', 'cad', noOfficial);
    expect(scored.map((s) => s.value)).toEqual(rows.map((r) => r.points));
  });

  it('75902 seniors -60 on 2026-11-02 = 2517 (1890 + 627), junior WC as junior_world_ch 3rd = 175', () => {
    const { rows, results, comps } = breakdownToResults(75902, 'm', '-60');
    const entry = computeRanking(results, comps, '2026-11-02', 'sen', noOfficial).get('sen-m-60')![0];
    expect(entry.points).toBe(2517);
    expect(sum(counted(entry.results, 'current'))).toBe(1890);
    expect(sum(counted(entry.results, 'previous'))).toBe(627);
    const jwc = entry.results.find((r) => r.meta.code === 'wc_jun2025')!;
    expect(jwc).toMatchObject({ base: 350, value: 175, period: 'previous', counted: true });
    expect(jwc.meta.eventType).toBe('junior_world_ch');
    const scored = scoreResults(results, comps, '2026-11-02', 'sen', noOfficial);
    expect(scored.map((s) => s.value)).toEqual(rows.map((r) => r.points));
  });

  it('75902 on 2026-11-16: Montreal Open 2024 (week 46) expires -> 2492', () => {
    const { results, comps } = breakdownToResults(75902, 'm', '-60');
    const entry = computeRanking(results, comps, '2026-11-16', 'sen', noOfficial).get('sen-m-60')![0];
    expect(entry.points).toBe(2492);
    const montreal = entry.results.find((r) => r.meta.code === 'cont_open_can2024')!;
    expect(montreal).toMatchObject({ period: 'expired', value: 0, counted: false, expireDate: '2026-11-16' });
  });
});

describe('period boundaries', () => {
  it('day before half -> current, half date -> previous, expire date -> expired', () => {
    const c = comp('grand_slam', '2025-10-17'); // half 2026-10-19, expire 2027-10-25
    const r = [res(c, 1, 1)];
    const at = (d: string) => scoreResults(r, mapOf([c]), d, 'sen', noOfficial)[0];
    expect(at('2026-10-18')).toMatchObject({ period: 'current', value: 1000, halfDate: '2026-10-19' });
    expect(at('2026-10-19')).toMatchObject({ period: 'previous', value: 500 });
    expect(at('2027-10-24')).toMatchObject({ period: 'previous', value: 500 });
    expect(at('2027-10-25')).toMatchObject({ period: 'expired', value: 0, counted: false, expireDate: '2027-10-25' });
  });
});

describe('senior counting', () => {
  it('7 current results of 100 each + 1 of 1000 -> only best 6 count (1500)', () => {
    const cs = [...Array(7)].map((_, i) => comp('grand_slam', `2026-0${i + 1}-10`));
    const big = comp('grand_slam', '2026-09-10');
    const results = [...cs.map((c) => res(c, 1, 33)), res(big, 1, 1)]; // place 33 + 1 win -> 100
    const e = computeRanking(results, mapOf([...cs, big]), '2026-11-02', 'sen', noOfficial).get('sen-m-60')![0];
    expect(e.points).toBe(1500);
    expect(e.results.filter((r) => r.counted)).toHaveLength(6);
    expect(e.results.find((r) => r.result.competitionId === big.id)!.counted).toBe(true);
  });

  it('best 6 previous counted separately from best 6 current', () => {
    const cur = [...Array(6)].map((_, i) => comp('grand_slam', `2026-0${i + 1}-10`));
    const prev = [...Array(7)].map((_, i) => comp('grand_slam', `2025-0${i + 1}-03`));
    const results = [...cur.map((c) => res(c, 1, 1)), ...prev.map((c) => res(c, 1, 1))];
    const e = computeRanking(results, mapOf([...cur, ...prev]), '2026-11-02', 'sen', noOfficial).get('sen-m-60')![0];
    expect(e.points).toBe(6 * 1000 + 6 * 500);
  });

  it('results in unfinished categories are ignored entirely', () => {
    const a = comp('grand_slam', '2026-10-29');
    const results = [res(a, 1, 1, { categoryFinished: false }), res(a, 2, 2)];
    const scored = scoreResults(results, mapOf([a]), '2026-11-02', 'sen', noOfficial);
    expect(scored.map((s) => s.result.idPerson)).toEqual([2]);
  });
});

describe('domestic rule', () => {
  it('3 UAE athletes placed 3, 5, 7 at a UAE GS -> the 7th place gets value 0', () => {
    const gs = comp('grand_slam', '2026-10-29', 'sen', 'UAE');
    const results = [
      res(gs, 1, 3, { country: 'UAE' }), res(gs, 2, 5, { country: 'UAE' }), res(gs, 3, 7, { country: 'UAE' }),
      res(gs, 4, 7, { country: 'ISR' }),
    ];
    const scored = scoreResults(results, mapOf([gs]), '2026-11-02', 'sen', noOfficial);
    const v = (id: number) => scored.find((s) => s.result.idPerson === id)!;
    expect(v(1).value).toBe(500);
    expect(v(2).value).toBe(360);
    expect(v(3)).toMatchObject({ base: 260, value: 0, counted: false });
    expect(v(4).value).toBe(260);
  });

  it('tied host places are broken by better official place (undefined = worst)', () => {
    const gp = comp('grand_prix', '2026-10-29', 'sen', 'UAE');
    const results = [1, 2, 3].map((id) => res(gp, id, 7, { country: 'UAE' }));
    const official = (id: number) => ({ 1: undefined, 2: 40, 3: 12 } as Record<number, number | undefined>)[id];
    const scored = scoreResults(results, mapOf([gp]), '2026-11-02', 'sen', official);
    expect(scored.find((s) => s.result.idPerson === 1)!.value).toBe(0);
    expect(scored.filter((s) => s.value > 0).map((s) => s.result.idPerson).sort()).toEqual([2, 3]);
  });

  it('applies per category: 2 hosts in each of two categories all score', () => {
    const gs = comp('grand_slam', '2026-10-29', 'sen', 'UAE');
    const results = [
      res(gs, 1, 3, { country: 'UAE' }), res(gs, 2, 5, { country: 'UAE' }),
      res(gs, 3, 3, { country: 'UAE', weight: '-66' }), res(gs, 4, 5, { country: 'UAE', weight: '-66' }),
    ];
    const scored = scoreResults(results, mapOf([gs]), '2026-11-02', 'sen', noOfficial);
    expect(scored.every((s) => s.value > 0)).toBe(true);
  });

  it('cadet world ch: only the 10 best host men score across categories; women counted separately', () => {
    const wc = comp('world_ch', '2026-08-20', 'cad', 'ECU');
    const weights = ['-50', '-55', '-60', '-66', '-73', '-81', '-90', '+90'];
    const men = [...Array(11)].map((_, i) =>
      res(wc, 100 + i, i < 8 ? 7 : 9, { country: 'ECU', weight: weights[i % 8] }));
    const women = [...Array(10)].map((_, i) => res(wc, 200 + i, 9, { country: 'ECU', gender: 'f', weight: '-52' }));
    const scored = scoreResults([...men, ...women], mapOf([wc]), '2026-10-26', 'cad', noOfficial);
    const zero = scored.filter((s) => s.value === 0).map((s) => s.result.idPerson);
    expect(zero).toEqual([110]); // worst place (9), highest id among ties without official places
  });

  it('junior world ch: 9 + 9 host athletes; the 10th host man gets 0 in junior and senior views', () => {
    const wc = comp('world_ch', '2025-10-05', 'jun', 'PER');
    const men = [...Array(10)].map((_, i) => res(wc, 300 + i, i === 9 ? 9 : 7, { country: 'PER', weight: `-${60 + i}` }));
    for (const view of ['jun', 'sen'] as const) {
      const scored = scoreResults(men, mapOf([wc]), '2025-11-03', view, noOfficial);
      expect(scored.filter((s) => s.value === 0).map((s) => s.result.idPerson)).toEqual([309]);
    }
  });

  it('no domestic filter when hostCountry is empty', () => {
    const gs = comp('grand_slam', '2026-10-29', 'sen', '');
    const results = [1, 2, 3].map((id) => res(gs, id, 7, { country: '' }));
    expect(scoreResults(results, mapOf([gs]), '2026-11-02', 'sen', noOfficial).every((s) => s.value > 0)).toBe(true);
  });
});

describe('views', () => {
  it('junior WC enters the senior view in the same weight; senior events are not in the junior view', () => {
    const jwc = comp('world_ch', '2026-10-05', 'jun');
    const gs = comp('grand_slam', '2026-10-29');
    const results = [res(jwc, 1, 1), res(gs, 1, 1)];
    const sen = computeRanking(results, mapOf([jwc, gs]), '2026-11-02', 'sen', noOfficial);
    expect(sen.get('sen-m-60')![0].points).toBe(700 + 1000);
    const jun = computeRanking(results, mapOf([jwc, gs]), '2026-11-02', 'jun', noOfficial);
    expect(jun.get('jun-m-60')![0].points).toBe(700);
    expect(jun.has('sen-m-60')).toBe(false);
  });

  it('cadet events are not in the senior or junior view; junior GP not in the senior view', () => {
    const cwc = comp('world_ch', '2026-08-20', 'cad');
    const jgp = comp('grand_prix', '2026-09-01', 'jun');
    const results = [res(cwc, 1, 1), res(jgp, 1, 1)];
    expect(scoreResults(results, mapOf([cwc, jgp]), '2026-11-02', 'sen', noOfficial)).toEqual([]);
    expect(scoreResults(results, mapOf([cwc, jgp]), '2026-11-02', 'jun', noOfficial).map((s) => s.meta.id))
      .toEqual([jgp.id]);
  });
});

describe('junior/cadet counting', () => {
  it('per period: best 3 of GP + cups, the latest continental ch, the latest world ch', () => {
    const cups = [...Array(4)].map((_, i) => comp('continental_cup', `2026-0${i + 2}-07`, 'cad'));
    const gp = comp('grand_prix', '2026-03-20', 'cad');
    const ecOld = comp('continental_ch', '2026-01-10', 'cad');
    const ecNew = comp('continental_ch', '2026-06-29', 'cad');
    const wcOld = comp('world_ch', '2026-02-20', 'cad');
    const wcNew = comp('world_ch', '2026-08-20', 'cad');
    const results = [
      ...cups.map((c, i) => res(c, 1, ([1, 2, 3, 5] as Place[])[i])), // 100, 70, 50, 40
      res(gp, 1, 2), // 280
      res(ecOld, 1, 1), // 300, older -> not counted even though higher
      res(ecNew, 1, 7), // 90
      res(wcOld, 1, 1), // 700, older -> not counted
      res(wcNew, 1, 9), // 112
    ];
    const e = computeRanking(results, mapOf([...cups, gp, ecOld, ecNew, wcOld, wcNew]), '2026-10-26', 'cad', noOfficial)
      .get('cad-m-60')![0];
    expect(e.points).toBe(280 + 100 + 70 + 90 + 112);
    const c = (m: CompetitionMeta) => e.results.find((r) => r.meta.id === m.id)!.counted;
    expect([c(ecOld), c(wcOld), c(cups[2]), c(cups[3])]).toEqual([false, false, false, false]);
  });

  it('the previous period has its own best 3 + latest continental + latest world', () => {
    const wcCur = comp('world_ch', '2026-08-20', 'jun');
    const wcPrev = comp('world_ch', '2025-10-05', 'jun');
    const gpPrev = comp('grand_prix', '2025-04-05', 'jun');
    const results = [res(wcCur, 1, 1), res(wcPrev, 1, 1), res(gpPrev, 1, 1)];
    const e = computeRanking(results, mapOf([wcCur, wcPrev, gpPrev]), '2026-10-26', 'jun', noOfficial)
      .get('jun-m-60')![0];
    expect(e.points).toBe(700 + 350 + 200);
  });
});

describe('ranking order', () => {
  it('two athletes at 1000: the one with a counted world_ch result is ranked higher', () => {
    const gs = comp('grand_slam', '2026-10-29');
    const wc = comp('world_ch', '2026-10-04');
    const results = [res(gs, 1, 1), res(wc, 2, 3)];
    const list = computeRanking(results, mapOf([gs, wc]), '2026-11-02', 'sen', noOfficial).get('sen-m-60')!;
    expect(list.map((e) => [e.idPerson, e.points, e.place])).toEqual([[2, 1000, 1], [1, 1000, 2]]);
  });

  it('senior: equal points, no WC -> higher GP/GS/masters sum ranks higher', () => {
    const gs = comp('grand_slam', '2026-10-29');
    const cc = comp('continental_ch', '2026-04-16');
    const co1 = comp('continental_open', '2026-03-01');
    const co2 = comp('continental_open', '2026-05-01');
    const results = [res(cc, 1, 1), res(co1, 1, 1), res(co2, 1, 1), res(gs, 2, 1)]; // both 1000
    const list = computeRanking(results, mapOf([gs, cc, co1, co2]), '2026-11-02', 'sen', noOfficial).get('sen-m-60')!;
    expect(list.map((e) => [e.idPerson, e.points])).toEqual([[2, 1000], [1, 1000]]);
  });

  it('senior: equal points, WC and GP/GS sums -> highest single values decide in turn', () => {
    const gs = comp('grand_slam', '2026-10-29');
    const cc = comp('continental_ch', '2026-04-16');
    const co1 = comp('continental_open', '2026-03-01');
    const co2 = comp('continental_open', '2026-05-01');
    const results = [
      res(gs, 5, 2), res(cc, 5, 5), res(co1, 5, 1), res(co2, 5, 17), // 700 + 288 + 100 + 12 = 1100
      res(gs, 6, 2), res(cc, 6, 3), // 700 + 400 = 1100; second single 400 > 288
    ];
    const list = computeRanking(results, mapOf([gs, cc, co1, co2]), '2026-11-02', 'sen', noOfficial).get('sen-m-60')!;
    expect(list.map((e) => [e.idPerson, e.points, e.place])).toEqual([[6, 1100, 1], [5, 1100, 2]]);
  });

  it('fully tied athletes are ordered by idPerson and get consecutive places', () => {
    const gs = comp('grand_slam', '2026-10-29');
    const results = [res(gs, 9, 3), res(gs, 4, 3), res(gs, 7, 1)];
    const list = computeRanking(results, mapOf([gs]), '2026-11-02', 'sen', noOfficial).get('sen-m-60')!;
    expect(list.map((e) => [e.idPerson, e.place])).toEqual([[7, 1], [4, 2], [9, 3]]);
  });

  it('juniors/cadets: equal points, no WC -> grand prix sum beats continental ch + cup', () => {
    const gp1 = comp('grand_prix', '2026-03-01', 'cad');
    const gp2 = comp('grand_prix', '2026-04-01', 'cad');
    const cc = comp('continental_ch', '2026-06-29', 'cad');
    const cup = comp('continental_cup', '2026-05-02', 'cad');
    const results = [
      res(cc, 1, 1), res(cup, 1, 1), // 300 + 100 = 400, GP 0
      res(gp1, 2, 3), res(gp2, 2, 3), // 200 + 200 = 400, GP 400
    ];
    const list = computeRanking(results, mapOf([gp1, gp2, cc, cup]), '2026-10-26', 'cad', noOfficial)
      .get('cad-m-60')!;
    expect(list.map((e) => [e.idPerson, e.points])).toEqual([[2, 400], [1, 400]]);
  });

  it('juniors/cadets: a counted world ch result breaks an equal-points tie', () => {
    const wc = comp('world_ch', '2026-08-20', 'jun');
    const gp = comp('grand_prix', '2026-03-01', 'jun');
    const gp2 = comp('grand_prix', '2026-04-01', 'jun');
    const results = [res(gp, 1, 9), res(gp2, 1, 17), res(wc, 2, 9)]; // 64 + 48 = 112 vs WC 1/16 = 112
    const list = computeRanking(results, mapOf([wc, gp, gp2]), '2026-10-26', 'jun', noOfficial).get('jun-m-60')!;
    expect(list.map((e) => [e.idPerson, e.points])).toEqual([[2, 112], [1, 112]]);
  });
});
