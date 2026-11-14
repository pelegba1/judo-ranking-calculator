import { describe, it, expect } from 'vitest';
import { countriesOf, matchesName, normalizeName, searchable } from '../../src/web/search';
import type { Person } from '../../src/engine/types';

describe('normalizeName', () => {
  it('drops case, accents and punctuation', () => {
    expect(normalizeName('ÐURĐEVIĆ Željko')).toBe('durdevic zeljko');
    expect(normalizeName("O'NEILL-Smith  Anne")).toBe('o neill smith anne');
    expect(normalizeName('  ')).toBe('');
  });
});

describe('matchesName', () => {
  it('matches every word in any order, as substrings', () => {
    expect(matchesName('SMITH John', 'john smi')).toBe(true);
    expect(matchesName('SMITH John', 'smith')).toBe(true);
    expect(matchesName('SMITH John', 'jane')).toBe(false);
    expect(matchesName('ŽELJKO Ivan', 'zeljko')).toBe(true);
  });
  it('an empty query matches nothing', () => {
    expect(matchesName('SMITH John', '   ')).toBe(false);
  });
});

describe('searchable', () => {
  it('needs at least two letters', () => {
    expect(searchable('a')).toBe(false);
    expect(searchable(' a ')).toBe(false);
    expect(searchable('ab')).toBe(true);
  });
});

describe('countriesOf', () => {
  const persons = new Map<number, Person>([
    [1, { id: 1, name: 'A', country: 'ISR', continent: 'Europe' }],
    [2, { id: 2, name: 'B', country: 'FRA', continent: 'Europe' }],
    [3, { id: 3, name: 'C', country: 'ISR', continent: 'Europe' }],
  ]);
  it('lists distinct codes, sorted, with the selected one kept', () => {
    expect(countriesOf([1, 2, 3, 99], persons)).toEqual(['FRA', 'ISR']);
    expect(countriesOf([2], persons, 'JPN')).toEqual(['FRA', 'JPN']);
    expect(countriesOf([1], undefined)).toEqual([]);
  });
});
