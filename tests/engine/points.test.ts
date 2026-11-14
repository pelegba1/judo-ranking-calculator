import { describe, it, expect } from 'vitest';
import { basePoints } from '../../src/engine/rules/points';
import type { EventType, Place } from '../../src/engine/types';

const D = '2026-03-01';
const SENIOR: Record<string, number[]> = {
  continental_open: [100, 70, 50, 36, 26, 16, 12, 10, 2],
  continental_ch: [800, 560, 400, 288, 208, 128, 96, 80, 6],
  junior_world_ch: [700, 490, 350, 252, 182, 112, 84, 70, 6],
  grand_prix: [700, 490, 350, 252, 182, 112, 84, 70, 6],
  grand_slam: [1000, 700, 500, 360, 260, 160, 120, 100, 10],
  masters: [1800, 1260, 900, 648, 468, 288, 216, 0, 100],
  world_ch: [2000, 1400, 1000, 720, 520, 320, 240, 200, 20],
  olympic_games: [2200, 1540, 1100, 792, 572, 352, 264, 0, 0],
};
const PLACES: Place[] = [1, 2, 3, 5, 7, 9, 17];

describe('senior points', () => {
  for (const [ev, row] of Object.entries(SENIOR)) {
    it(`${ev} full row`, () => {
      PLACES.forEach((p, i) => expect(basePoints('sen', ev as EventType, p, 2, D)).toBe(row[i]));
      expect(basePoints('sen', ev as EventType, 33, 1, D)).toBe(row[7]);
      expect(basePoints('sen', ev as EventType, 33, 0, D)).toBe(row[8]);
    });
  }
  it('spec anchors', () => {
    expect(basePoints('sen', 'grand_slam', 9, 1, D)).toBe(160);
    expect(basePoints('sen', 'world_ch', 9, 1, D)).toBe(320);
    expect(basePoints('sen', 'masters', 17, 1, D)).toBe(216);
    expect(basePoints('sen', 'continental_ch', 5, 2, D)).toBe(288);
    expect(basePoints('sen', 'junior_world_ch', 3, 3, D)).toBe(350);
    expect(basePoints('sen', 'continental_open', 3, 2, D)).toBe(50);
  });
  it('zero wins gives participation regardless of place', () => {
    expect(basePoints('sen', 'grand_slam', 33, 0, D)).toBe(10);
    expect(basePoints('sen', 'world_ch', 33, 0, D)).toBe(20);
    expect(basePoints('sen', 'masters', 17, 0, D)).toBe(100);
    expect(basePoints('sen', 'olympic_games', 17, 0, D)).toBe(0);
  });
  it('one win at place 33+', () => {
    expect(basePoints('sen', 'grand_slam', 33, 1, D)).toBe(100);
    expect(basePoints('sen', 'masters', 33, 1, D)).toBe(0);
    expect(basePoints('sen', 'grand_slam', 129, 1, D)).toBe(100);
  });
});

describe('junior/cadet 2026 points', () => {
  it('confirmed anchors', () => {
    expect(basePoints('cad', 'world_ch', 1, 5, D)).toBe(700);
    expect(basePoints('cad', 'continental_ch', 2, 3, D)).toBe(210);
    expect(basePoints('cad', 'continental_cup', 1, 4, D)).toBe(100);
    expect(basePoints('cad', 'continental_cup', 2, 3, D)).toBe(70);
    expect(basePoints('cad', 'continental_cup', 7, 1, D)).toBe(30);
  });
  const J: Record<string, (number | null)[]> = {
    continental_cup: [100, 70, 50, 40, 30, null, null, null, 6, 2],
    continental_ch: [300, 210, 150, 120, 90, null, null, null, 18, 4],
    grand_prix: [400, 280, 200, 160, 120, 64, 48, 40, 24, 6],
    world_ch: [700, 490, 350, 280, 210, 112, 84, 70, 42, 6],
  };
  for (const age of ['jun', 'cad'] as const) {
    for (const [ev, r] of Object.entries(J)) {
      it(`${age} ${ev}`, () => {
        const e = ev as EventType;
        [1, 2, 3, 5, 7].forEach((p, i) => expect(basePoints(age, e, p as Place, 2, D)).toBe(r[i]));
        expect(basePoints(age, e, 9, 1, D)).toBe(r[5] ?? r[8]);
        expect(basePoints(age, e, 17, 1, D)).toBe(r[6] ?? r[8]);
        expect(basePoints(age, e, 33, 1, D)).toBe(r[7] ?? r[8]);
        expect(basePoints(age, e, 65, 3, D)).toBe(3 * (r[8] as number));
        expect(basePoints(age, e, 33, 0, D)).toBe(r[9]);
      });
    }
  }
  it('pre-2026 date currently reuses 2026 table', () => {
    expect(basePoints('cad', 'world_ch', 1, 5, '2025-06-01')).toBe(700);
  });
});
