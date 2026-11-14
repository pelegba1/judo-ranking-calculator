import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { derivePlacings } from '../../src/engine/placings';
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

  it('3157: every competitor appears exactly once', () => {
    const { f, res } = run('3157', 3157);
    const ids = Object.values(f.competitors.categories as Record<string, Record<string, { persons: Record<string, { id_person: string }> }>>)
      .flatMap((ag) => Object.values(ag).flatMap((c) => Object.values(c.persons).map((p) => Number(p.id_person))));
    for (const id of ids) expect(res.filter((r) => r.idPerson === id)).toHaveLength(1);
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

  it('never counts a bye as a win', () => {
    const f = load('3157');
    const c = f.contests.find((b) => b.round_name === 'Round of 32')!;
    const w = Number(c.id_winner);
    const base = derivePlacings(meta(3157), f.contests, f.competitors, f.results).find((r) => r.idPerson === w)!;
    const byed = f.contests.map((b) => (b === c ? { ...b, bye: '1' } : b));
    const after = derivePlacings(meta(3157), byed, f.competitors, f.results).find((r) => r.idPerson === w)!;
    expect(after.wins).toBe(base.wins - 1);
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
  const loserOf = (b: RawContest) => (b.id_winner === b.id_person_white ? b.id_person_blue : b.id_person_white)!;

  it('3157: QF loser losing repechage is 7; repechage winner losing bronze is 5 (wins over all bouts)', () => {
    const { f, res } = run('3157', 3157);
    const reps = f.contests.filter((b) => b.round_name === 'Repechage');
    const qf7 = reps.map(loserOf).filter((id) => lostIn(f.contests, id, 'Quarter-Final'));
    expect(qf7.length).toBeGreaterThan(0);
    for (const id of qf7) expect(res.find((r) => r.idPerson === Number(id))!.place).toBe(7);

    const viaRep = f.contests.filter((b) => b.round_name === 'Bronze').map(loserOf)
      .filter((id) => reps.some((b) => b.id_winner === id));
    expect(viaRep.length).toBeGreaterThan(0);
    for (const id of viaRep) {
      const a = res.find((r) => r.idPerson === Number(id))!;
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

  it('entrant with no bouts gets the first-round loss place and 0 wins', () => {
    const f = load('3157');
    const idWeight = f.contests.find((b) => b.id_person_white === '20144' || b.id_person_blue === '20144')!.id_weight;
    const rounds = f.contests.filter((b) => b.id_weight === idWeight)
      .map((b) => /^Round of (\d+)$/.exec(b.round_name)).filter(Boolean).map((m) => Number(m![1]));
    const expected = Math.max(...rounds) / 2 + 1;
    const comp = JSON.parse(JSON.stringify(f.competitors));
    const group = (Object.values(comp.categories) as Record<string, { persons: Record<string, unknown> }>[])
      .map((ag) => ag[idWeight]).find(Boolean)!;
    group.persons['999999'] = { id_person: '999999', country_short: 'XXX', gender: '1', id_weight: idWeight };
    const a = derivePlacings(meta(3157), f.contests, comp, f.results).find((r) => r.idPerson === 999999)!;
    expect(a.place).toBe(expected);
    expect(a.wins).toBe(0);
    expect(a.country).toBe('XXX');
  });

  it('partial-3159: every athlete of an unfinished category is categoryFinished=false', () => {
    const { f, res } = run('partial-3159', 3159);
    const unfinished = [...new Set(f.contests.map((b) => b.id_weight))].filter((w) => {
      const fin = f.contests.find((b) => b.id_weight === w && b.round_name === 'Final');
      return !fin || fin.is_finished !== '1';
    });
    expect(unfinished.length).toBeGreaterThan(0);
    let n = 0;
    for (const w of unfinished) {
      for (const b of f.contests.filter((x) => x.id_weight === w)) {
        for (const id of [b.id_person_white, b.id_person_blue]) {
          expect(res.find((r) => r.idPerson === Number(id))!.categoryFinished).toBe(false);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('3177: gender comes from the person, not the (wrong) category gender', () => {
    const { res } = run('3177', 3177);
    const men = res.filter((r) => ['-60', '-66', '-73', '-81', '-90', '-100', '+100'].includes(r.weight));
    expect(men.length).toBeGreaterThan(0);
    expect(men.every((r) => r.gender === 'm')).toBe(true);
    expect(res.filter((r) => r.gender === 'f').length).toBeGreaterThan(0);
  });
});
