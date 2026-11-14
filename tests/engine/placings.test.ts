import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { derivePlacings, isWalkover } from '../../src/engine/placings';
import type { CompetitionMeta } from '../../src/engine/types';
import type { RawContest } from '../../src/data/ijf-api';

const load = (id: string) => {
  const d = (f: string) => JSON.parse(readFileSync(`tests/fixtures/competitions/${id}/${f}.json`, 'utf8'));
  return { contests: d('contests').contests as RawContest[], competitors: d('competitors'), results: d('results') };
};
const meta = (id: number): CompetitionMeta => ({
  id, code: 'X', name: 'X', dateFrom: '2026-01-01', dateTo: '2026-01-02',
  age: 'sen', eventType: 'grand_slam', hostCountry: 'UAE',
});
const run = (dir: string, id: number) => {
  const f = load(dir);
  return { f, res: derivePlacings(meta(id), f.contests, f.competitors, f.results) };
};

describe('derivePlacings', () => {
  it('3157: winner 20144 has place 1 and >= 4 wins', () => {
    const { res } = run('3157', 3157);
    const a = res.find((r) => r.idPerson === 20144)!;
    expect(a.place).toBe(1);
    expect(a.wins).toBeGreaterThanOrEqual(4);
    expect(a.weight).toBe('-60');
    expect(a.categoryFinished).toBe(true);
  });

  it('3157: every competitor who fought appears exactly once; the others not at all', () => {
    const { f, res } = run('3157', 3157);
    const ids = Object.values(f.competitors.categories as Record<string, Record<string, { persons: Record<string, { id_person: string }> }>>)
      .flatMap((ag) => Object.values(ag).flatMap((c) => Object.values(c.persons).map((p) => Number(p.id_person))));
    const fought = new Set(f.contests.filter((b) => !isWalkover(b)).flatMap((b) => [Number(b.id_person_white), Number(b.id_person_blue)]));
    for (const b of f.contests.filter(isWalkover)) fought.add(Number(b.id_winner));
    for (const id of ids) expect(res.filter((r) => r.idPerson === id)).toHaveLength(fought.has(id) ? 1 : 0);
    expect(ids.filter((id) => fought.has(id)).length).toBeGreaterThan(300);
    expect(new Set(res.map((r) => r.idPerson)).size).toBe(res.length);
  });

  it('3151: 20144 lost in 1/16 -> place 9 with >= 1 win', () => {
    const { res } = run('3151', 3151);
    const a = res.find((r) => r.idPerson === 20144)!;
    expect(a.place).toBe(9);
    expect(a.wins).toBeGreaterThanOrEqual(1);
  });

  it('3191: 97658 is 2nd; bronze winners of the category are 3rd', () => {
    const { f, res } = run('3191', 3191);
    const a = res.find((r) => r.idPerson === 97658)!;
    expect(a.place).toBe(2);
    const idWeight = f.contests.find((c) => c.id_person_white === '97658' || c.id_person_blue === '97658')!.id_weight;
    const bronze = f.contests.filter((b) => b.round_name === 'Bronze' && b.id_weight === idWeight);
    expect(bronze).toHaveLength(2);
    for (const b of bronze) expect(res.find((r) => r.idPerson === Number(b.id_winner))!.place).toBe(3);
  });

  it('a bye-flagged bout between two competitors still counts as a win (cont_cup_jun_uzb2026: official "fights won")', () => {
    const f = load('3157');
    const c = f.contests.find((b) => b.round_name === 'Round of 32')!;
    const w = Number(c.id_winner);
    const base = derivePlacings(meta(3157), f.contests, f.competitors, f.results).find((r) => r.idPerson === w)!;
    const byed = f.contests.map((b) => (b === c ? { ...b, bye: '1' } : b));
    expect(derivePlacings(meta(3157), byed, f.competitors, f.results).find((r) => r.idPerson === w)!.wins).toBe(base.wins);
    const alone = f.contests.map((b) => (b === c ? { ...b, bye: '1', [w === Number(b.id_person_white) ? 'id_person_blue' : 'id_person_white']: null } : b));
    expect(derivePlacings(meta(3157), alone, f.competitors, f.results).find((r) => r.idPerson === w)!.wins).toBe(base.wins - 1);
  });

  it('partial-3159: categoryFinished follows the Final bout', () => {
    const { f, res } = run('partial-3159', 3159);
    const finals = f.contests.filter((b) => b.round_name === 'Final');
    const byWeight = new Map(finals.map((b) => [`${b.id_weight}`, b.is_finished === '1']));
    const idWeightOf = new Map<number, string>();
    for (const b of f.contests) {
      if (b.id_person_white) idWeightOf.set(Number(b.id_person_white), b.id_weight);
      if (b.id_person_blue) idWeightOf.set(Number(b.id_person_blue), b.id_weight);
    }
    let t = 0, fl = 0;
    for (const r of res) {
      const fin = byWeight.get(idWeightOf.get(r.idPerson) ?? '') === true;
      expect(r.categoryFinished).toBe(fin);
      fin ? t++ : fl++;
    }
    expect(t).toBeGreaterThan(0);
    expect(fl).toBeGreaterThan(0);
  });

  const fightsOf = (cs: RawContest[], id: string) => cs.filter((b) => b.id_person_white === id || b.id_person_blue === id);
  const lostIn = (cs: RawContest[], id: string, round: string) =>
    cs.some((b) => b.round_name === round && b.id_winner && b.id_winner !== id && (b.id_person_white === id || b.id_person_blue === id));
  const loserOf = (b: RawContest) => {
    if (!b.id_winner) throw new Error("bout without winner");
    return (b.id_winner === b.id_person_white ? b.id_person_blue : b.id_person_white)!;
  };

  it('3157: QF loser losing repechage is 7; repechage winner losing bronze is 5 (wins over all bouts)', () => {
    const { f, res } = run('3157', 3157);
    const reps = f.contests.filter((b) => b.round_name === 'Repechage');
    const wOf = (id: string) => fightsOf(f.contests, id)[0].weight;
    const qf7 = reps.map(loserOf).filter((id) => lostIn(f.contests, id, 'Quarter-Final'));
    expect(qf7.length).toBeGreaterThan(0);
    for (const id of qf7) expect(res.find((r) => r.idPerson === Number(id) && r.weight === wOf(id))!.place).toBe(7);

    const viaRep = f.contests.filter((b) => b.round_name === 'Bronze').map(loserOf)
      .filter((id) => reps.some((b) => b.id_winner === id));
    expect(viaRep.length).toBeGreaterThan(0);
    for (const id of viaRep) {
      const a = res.find((r) => r.idPerson === Number(id) && r.weight === wOf(id))!;
      expect(a.place).toBe(5);
      expect(a.wins).toBe(fightsOf(f.contests, id).filter((b) => b.id_winner === id).length);
    }
  });

  it('3177: relative rounds map last->9, previous->17, previous->33', () => {
    const { f, res } = run('3177', 3177);
    const cs = f.contests.filter((b) => b.id_weight === '44'); // -60: Round 1..3
    const only = (round: string) =>
      cs.filter((b) => b.round_name === round).map(loserOf)
        .filter((id) => !fightsOf(cs, id).some((b) => b.round_name === 'Repechage'));
    const expectPlace = (round: string, place: number) => {
      const ids = only(round);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(res.find((r) => r.idPerson === Number(id) && r.weight === '-60')!.place).toBe(place);
    };
    expectPlace('Round 3', 9);
    expectPlace('Round 2', 17);
    expectPlace('Round 1', 33);
  });

  it('entrant with no bouts: no result in a finished category, first-round loss place while it runs', () => {
    // 3157 -60 (id_weight 1) starts at Round of 32 (verified in fixture): first-round loser gets 17
    const f = load('3157');
    expect(new Set(f.contests.filter((b) => b.id_weight === '1').map((b) => b.round_name)).has('Round of 64')).toBe(false);
    expect(f.contests.some((b) => b.id_weight === '1' && b.round_name === 'Round of 32')).toBe(true);
    const comp = JSON.parse(JSON.stringify(f.competitors));
    const group = (Object.values(comp.categories) as Record<string, { persons: Record<string, unknown> }>[])
      .map((ag) => ag['1']).find(Boolean)!;
    group.persons['999999'] = { id_person: '999999', country_short: 'XXX', gender: '1', id_weight: '1' };
    expect(derivePlacings(meta(3157), f.contests, comp, f.results).find((r) => r.idPerson === 999999)).toBeUndefined();
    const running = f.contests.map((b) => (b.id_weight === '1' && b.round_name === 'Final' ? { ...b, is_finished: '0', id_winner: null } : b));
    const a = derivePlacings(meta(3157), running, comp, f.results).find((r) => r.idPerson === 999999 && r.weight === '-60')!;
    expect(a).toMatchObject({ place: 17, wins: 0, country: 'XXX', categoryFinished: false });
  });

  // Synthetic category helpers (Task 7 rules, each checked against official breakdown pages)
  let fightId = 1;
  const bout = (round: string, white: number, blue: number, winner: number | null, extra: Partial<RawContest> = {}): RawContest => ({
    id_fight: String(fightId++), id_person_white: String(white), id_person_blue: String(blue),
    id_winner: winner === null ? null : String(winner), is_finished: '1', bye: '0', round_name: round,
    id_weight: '1', weight: '-60', age: 'Seniors', contest_code_long: 'x_m_0060_0001', duration: '00:03:00',
    first_hajime_at_ts: '1760000000', ippon_w: '0', waza_w: '1', yuko_w: '0', penalty_w: '0', ippon_b: '0', waza_b: '0',
    yuko_b: '0', penalty_b: '0', ...extra,
  });
  const resultsOf = (places: Record<number, number>) => ({
    by_categories: { 1: { 1: { category: '-60', gender: 'male', persons: Object.entries(places).map(([id, place]) => ({ id_person: id, place, country_short: 'XXX', id_weight: '1' })) } } },
  });
  const noCompetitors = { categories: {} };
  // 8-man bracket: 1 beats 2 in the final; 3 and 4 bronze; 5..8 lose quarter-finals
  const bracket = (): RawContest[] => [
    bout('Quarter-Final', 1, 5, 1), bout('Quarter-Final', 2, 6, 2), bout('Quarter-Final', 3, 7, 3), bout('Quarter-Final', 4, 8, 4),
    bout('Semi-Final', 1, 3, 1), bout('Semi-Final', 2, 4, 2), bout('Repechage', 5, 7, 5), bout('Repechage', 6, 8, 6),
    bout('Bronze', 3, 6, 3), bout('Bronze', 4, 5, 4), bout('Final', 1, 2, 1),
  ];
  const place = (rs: ReturnType<typeof derivePlacings>, id: number) => rs.find((r) => r.idPerson === id);

  it('walkover loser (00:00:00, no hajime, single ippon) did not compete: no result; the winner has a win', () => {
    const walkover = { duration: '00:00:00', first_hajime_at_ts: '0', ippon_w: '1', waza_w: '0' };
    const cs = [...bracket(), bout('Round of 16', 1, 9, 1, walkover)];
    expect(isWalkover(cs[cs.length - 1])).toBe(true);
    const rs = derivePlacings(meta(1), cs, noCompetitors, resultsOf({ 1: 1, 2: 2, 3: 3, 4: 3, 5: 5, 6: 5, 7: 7, 8: 7 }));
    expect(place(rs, 9)).toBeUndefined();
    expect(place(rs, 1)!.wins).toBe(4); // R16 walkover + QF + SF + Final
    // a real bout with an unrecorded duration still has a hajime timestamp (cont_open_mar2025): the loser competed
    const timed = [...bracket(), bout('Round of 16', 1, 9, 1, { ...walkover, first_hajime_at_ts: '1737191320' })];
    expect(place(derivePlacings(meta(1), timed, noCompetitors, resultsOf({ 1: 1 })), 9)).toMatchObject({ place: 9, wins: 0 });
  });

  it('an athlete missing from the published places 1-7 is not 5th/7th (repechage from the last 16: cont_cup_jun_ita2026)', () => {
    // 10 lost the Round of 16 to 5, won a first repechage and lost the second: official "fights won", not 7th
    const cs = [...bracket(), bout('Round of 16', 5, 10, 5), bout('Repechage', 10, 11, 10), bout('Repechage', 7, 10, 7)];
    const rs = derivePlacings(meta(1), cs, noCompetitors, resultsOf({ 1: 1, 2: 2, 3: 3, 4: 3, 5: 5, 6: 5, 7: 7, 8: 7 }));
    expect(place(rs, 10)).toMatchObject({ place: 9, wins: 1 });
    expect(place(rs, 7)!.place).toBe(7);
  });

  it('a pool category (no Final) is finished once all bouts are and places are published; 4th scores as 5th', () => {
    // oju_sen2026 -73: 5 fighters, 'Round 1' pools + Bronze; results give places 1, 2, 3, 4
    const cs = [bout('Round 1', 1, 2, 1), bout('Round 1', 1, 3, 1), bout('Round 1', 2, 3, 2), bout('Round 1', 4, 5, 4),
      bout('Bronze', 3, 4, 3)];
    const rs = derivePlacings(meta(1), cs, noCompetitors, resultsOf({ 1: 1, 2: 2, 3: 3, 4: 4 }));
    expect(rs.every((r) => r.categoryFinished)).toBe(true);
    expect([1, 2, 3, 4, 5].map((id) => place(rs, id)!.place)).toEqual([1, 2, 3, 5, 9]);
    const unpublished = derivePlacings(meta(1), cs, noCompetitors, { by_categories: {} });
    expect(unpublished.some((r) => r.categoryFinished)).toBe(false);
  });

  it('a finished bout without a winner (withdrawal) ends the run in that round (gp_aut2026: official 1/32)', () => {
    const cs = [...bracket(), bout('Round of 32', 12, 13, 12), bout('Round of 16', 12, 1, null)];
    const rs = derivePlacings(meta(1), cs, noCompetitors, resultsOf({ 1: 1, 2: 2, 3: 3, 4: 3, 5: 5, 6: 5, 7: 7, 8: 7 }));
    expect(place(rs, 12)).toMatchObject({ place: 9, wins: 1 });
    expect(place(rs, 1)!.place).toBe(1);
  });

  it('partial-3159: unfinished categories get provisional places, never a medal for unbeaten athletes', () => {
    const { f, res } = run('partial-3159', 3159);
    const unfinished = [...new Set(f.contests.map((b) => b.id_weight))].filter((w) => {
      const fin = f.contests.find((b) => b.id_weight === w && b.round_name === 'Final');
      return !fin || fin.is_finished !== '1';
    });
    expect(unfinished.sort()).toEqual(['11', '3', '4']);
    for (const w of unfinished) {
      for (const b of f.contests.filter((x) => x.id_weight === w)) {
        for (const id of [b.id_person_white, b.id_person_blue]) {
          const a = res.find((r) => r.idPerson === Number(id) && r.weight === b.weight)!;
          expect(a.categoryFinished).toBe(false);
          expect(a.place).toBeGreaterThanOrEqual(9);
        }
      }
    }
    const at = (id: number, weight: string) => res.find((r) => r.idPerson === id && r.weight === weight)!;
    // -73: Round of 64 only. 73013 lost it (-> 33); 64502 won it and is unbeaten (provisional 9, not a medal)
    expect(at(73013, '-73').place).toBe(33);
    expect(at(64502, '-73').place).toBe(9);
    expect(at(64502, '-73').wins).toBe(1);
    // -63: Round of 32 only. 65773 lost it (-> 17); 48861 won it and is unbeaten
    expect(at(65773, '-63').place).toBe(17);
    expect(at(48861, '-63').place).toBe(9);
    // finished -60 category (id_weight 1): a Round of 16 loser with no repechage is 9
    const r16 = f.contests.filter((b) => b.id_weight === '1' && b.round_name === 'Round of 16')
      .map(loserOf).filter((id) => !fightsOf(f.contests.filter((b) => b.id_weight === '1'), id).some((b) => b.round_name === 'Repechage'));
    expect(r16.length).toBeGreaterThan(0);
    for (const id of r16) expect(at(Number(id), '-60').place).toBe(9);
  });

  it('3177: gender comes from the person, not the (wrong) category gender', () => {
    const { res } = run('3177', 3177);
    const men = res.filter((r) => ['-60', '-66', '-73', '-81', '-90', '-100', '+100'].includes(r.weight));
    expect(men.length).toBeGreaterThan(0);
    expect(men.every((r) => r.gender === 'm')).toBe(true);
    expect(res.filter((r) => r.gender === 'f').length).toBeGreaterThan(0);
  });
});
