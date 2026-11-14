import { describe, it, expect } from 'vitest';
import { isoWeek, mondayOfIsoWeek, decayDates } from '../../src/engine/dates';
import type { CompetitionMeta } from '../../src/engine/types';

const meta = (over: Partial<CompetitionMeta>): CompetitionMeta => ({
  id: 1, code: 'X', name: 'X', dateFrom: '2025-10-17', dateTo: '2025-10-19',
  age: 'sen', eventType: 'grand_slam', hostCountry: 'UAE', ...over,
});

describe('isoWeek', () => {
  it('computes ISO weeks', () => {
    expect(isoWeek('2026-10-29')).toEqual({ year: 2026, week: 44 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
  });
});

describe('mondayOfIsoWeek', () => {
  it('returns the Monday', () => {
    expect(mondayOfIsoWeek(2026, 43)).toBe('2026-10-19');
    expect(mondayOfIsoWeek(2026, 1)).toBe('2025-12-29');
  });
});

describe('decayDates', () => {
  it('grand slam week 42 -> week 43 of Y+1 / Y+2', () => {
    expect(decayDates(meta({}))).toEqual({ half: '2026-10-19', expire: '2027-10-25' });
  });
  it('week 10 of 2026 -> week 11', () => {
    expect(decayDates(meta({ dateFrom: '2026-03-06' }))).toEqual({ half: '2027-03-15', expire: '2028-03-13' });
  });
  it('senior continental_ch uses week 18', () => {
    expect(decayDates(meta({ eventType: 'continental_ch', dateFrom: '2026-04-16' })))
      .toEqual({ half: '2027-05-03', expire: '2028-05-01' });
  });
  it('junior/cadet continental_ch uses week 27', () => {
    for (const age of ['jun', 'cad'] as const) {
      const d = decayDates(meta({ eventType: 'continental_ch', age, dateFrom: '2026-04-16' }));
      expect(isoWeek(d.half)).toEqual({ year: 2027, week: 27 });
      expect(isoWeek(d.expire)).toEqual({ year: 2028, week: 27 });
    }
  });
  it('week 53 rolls over to week 1 of the following year', () => {
    expect(decayDates(meta({ dateFrom: '2026-12-31' }))).toEqual({ half: '2028-01-03', expire: '2029-01-01' });
  });
});
