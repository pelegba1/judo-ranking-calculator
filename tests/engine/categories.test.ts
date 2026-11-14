import { describe, it, expect } from 'vitest';
import { WEIGHTS, isWeightOf, categoryKey } from '../../src/engine/rules/categories';

describe('weight categories', () => {
  it('has 7 senior/junior and 8 cadet weights per gender', () => {
    for (const g of ['m', 'f'] as const) {
      expect(WEIGHTS.sen[g]).toHaveLength(7);
      expect(WEIGHTS.jun[g]).toEqual(WEIGHTS.sen[g]);
      expect(WEIGHTS.cad[g]).toHaveLength(8);
    }
  });

  it.each([
    ['sen', 'm', '-60', true], ['sen', 'm', '-55', false], ['sen', 'f', '-44', false], ['sen', 'f', '+78', true],
    ['jun', 'm', '+100', true], ['cad', 'm', '-55', true], ['cad', 'f', '+70', true], ['cad', 'm', '-100', false],
  ] as const)('%s %s %s -> %s', (age, g, w, ok) => expect(isWeightOf(age, g, w)).toBe(ok));

  it('builds category keys', () => {
    expect(categoryKey('cad', { gender: 'f', weight: '+70' })).toBe('cad-f+70');
  });
});
