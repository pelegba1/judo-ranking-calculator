import { describe, it, expect } from 'vitest';
import { guardOfficial } from '../../src/pipeline/official';
import type { OfficialEntry } from '../../src/engine/projection';
import type { CategoryKey } from '../../src/engine/types';

const rows = (category: CategoryKey, n: number, from = 1): OfficialEntry[] =>
  Array.from({ length: n }, (_, i) => ({ idPerson: from + i, category, place: i + 1, points: 100 - i }));

describe('guardOfficial', () => {
  const previous = {
    sen: [...rows('sen-m-60', 20), ...rows('sen-f-48', 20, 100)],
    jun: [...rows('jun-m-60', 10), ...rows('jun-f-48', 10, 100)],
    cad: [...rows('cad-m-50', 5), ...rows('cad-f-40', 5, 100)],
  };
  const cad = previous.cad;

  it('takes the fresh list when every age-gender is there and none shrank by more than 10%', () => {
    const fresh = [...rows('sen-m-60', 18), ...rows('sen-f-48', 21, 100), ...rows('jun-m-60', 10), ...rows('jun-f-48', 9, 100), ...cad];
    const g = guardOfficial(fresh, previous);
    expect(g.official).toEqual(fresh);
    expect(g.warnings).toEqual([]);
  });

  it('keeps the previous file of an age whose list for one gender is empty, with a warning', () => {
    const fresh = [...rows('sen-m-60', 20), ...rows('jun-m-60', 10), ...rows('jun-f-48', 10, 100), ...cad];
    const g = guardOfficial(fresh, previous);
    expect(g.official.filter((o) => o.category.startsWith('sen-'))).toEqual(previous.sen);
    expect(g.official.filter((o) => o.category.startsWith('jun-'))).toHaveLength(20);
    expect(g.warnings).toEqual([expect.stringMatching(/sen-f: 0 rows .*previous 20.*keeping the previous official-sen/)]);
  });

  it('keeps the previous file when a list drops by more than 10%', () => {
    const fresh = [...rows('sen-m-60', 17), ...rows('sen-f-48', 20, 100), ...rows('jun-m-60', 10), ...rows('jun-f-48', 10, 100), ...cad];
    const g = guardOfficial(fresh, previous);
    expect(g.official.filter((o) => o.category.startsWith('sen-'))).toEqual(previous.sen);
    expect(g.warnings).toEqual([expect.stringMatching(/sen-m: 17 rows .*previous 20/)]);
  });

  it('without a previous file an empty list is written but warned about', () => {
    const g = guardOfficial([...rows('sen-m-60', 5), ...rows('sen-f-48', 5, 100)], {});
    expect(g.official).toHaveLength(10);
    expect(g.warnings.some((w) => /^jun-m: 0 rows/.test(w))).toBe(true);
    expect(g.warnings.some((w) => /^cad-f: 0 rows/.test(w))).toBe(true);
  });
});
