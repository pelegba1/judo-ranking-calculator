import { describe, it, expect } from 'vitest';
import { project, type OfficialEntry } from '../../src/engine/projection';
import type { RankingEntry } from '../../src/engine/ranking';
import type { CategoryKey } from '../../src/engine/types';

const C: CategoryKey = 'sen-m-60';
const re = (idPerson: number, points: number, place: number): RankingEntry => ({ idPerson, category: C, points, place, results: [] });
const off = (idPerson: number, place: number, points: number): OfficialEntry => ({ idPerson, category: C, place, points });
const rank = (...e: RankingEntry[]) => new Map<CategoryKey, RankingEntry[]>([[C, e]]);
const get = (m: ReturnType<typeof project>, id: number) => m.get(C)!.find((p) => p.idPerson === id)!;

describe('project', () => {
  it('no change: projected equals official, same order', () => {
    const official = [off(1, 1, 5000), off(2, 2, 4000)];
    const r = rank(re(1, 5000, 1), re(2, 4000, 2));
    const out = project(official, r, r).get(C)!;
    expect(out.map((p) => p.idPerson)).toEqual([1, 2]);
    for (const p of out) { expect(p.projectedPoints).toBe(p.officialPoints); expect(p.delta).toBe(0); expect(p.verified).toBe(true); }
    expect(out.map((p) => p.projectedPlace)).toEqual([1, 2]);
  });

  it('engine mismatch is unverified but delta still applies exactly', () => {
    const official = [off(1, 1, 5473)];
    const out = project(official, rank(re(1, 5400, 1)), rank(re(1, 6400, 1)));
    const p = get(out, 1);
    expect(p.verified).toBe(false);
    expect(p.delta).toBe(1000);
    expect(p.projectedPoints).toBe(6473);
    expect(p.engine?.points).toBe(6400);
  });

  it('athlete absent from official, engine-after 700', () => {
    const out = project([off(1, 1, 5000)], rank(re(1, 5000, 1)), rank(re(1, 5000, 1), re(9, 700, 2)));
    const p = get(out, 9);
    expect(p.officialPlace).toBeNull();
    expect(p.officialPoints).toBe(0);
    expect(p.projectedPoints).toBe(700);
    expect(p.verified).toBe(true);
  });

  it('athlete absent from official but engine-before 50 is unverified', () => {
    const out = project([off(1, 1, 5000)], rank(re(1, 5000, 1), re(9, 50, 2)), rank(re(1, 5000, 1), re(9, 50, 2)));
    expect(get(out, 9).verified).toBe(false);
    expect(get(out, 9).projectedPoints).toBe(0); // official 0 + delta 0
  });

  it('official athlete absent from both before and after is kept', () => {
    const out = project([off(1, 1, 5000), off(2, 2, 300)], rank(re(1, 5000, 1)), rank(re(1, 5000, 1)));
    const p = get(out, 2);
    expect(p.projectedPoints).toBe(300);
    expect(p.delta).toBe(0);
    expect(p.engine).toBeNull();
    expect(p.verified).toBe(false);
  });

  it('ties in projectedPoints follow the after order', () => {
    const official = [off(1, 1, 1000), off(2, 2, 1000)];
    const before = rank(re(1, 1000, 1), re(2, 1000, 2));
    const after = rank(re(2, 1000, 1), re(1, 1000, 2));
    expect(project(official, before, after).get(C)!.map((p) => p.idPerson)).toEqual([2, 1]);
  });

  it('category only in after is output', () => {
    const k: CategoryKey = 'sen-f-48';
    const after = new Map<CategoryKey, RankingEntry[]>([[k, [{ idPerson: 5, category: k, points: 10, place: 1, results: [] }]]]);
    expect(project([], new Map(), after).get(k)![0].projectedPlace).toBe(1);
  });
});
