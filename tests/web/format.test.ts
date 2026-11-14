import { describe, expect, it } from 'vitest';
import { formatDate, formatDelta, formatMovement, formatPoints, isAffected, placeLabel } from '../../src/web/format';

describe('formatMovement', () => {
  it('moved up', () => expect(formatMovement(5, 2)).toEqual({ label: '▲3', dir: 'up' }));
  it('moved down', () => expect(formatMovement(2, 5)).toEqual({ label: '▼3', dir: 'down' }));
  it('same place', () => expect(formatMovement(4, 4)).toEqual({ label: '—', dir: 'same' }));
  it('new in the ranking', () => expect(formatMovement(null, 7)).toEqual({ label: 'חדש', dir: 'new' }));
});

describe('formatDate', () => {
  it('DD.MM.YYYY', () => expect(formatDate('2026-11-16')).toBe('16.11.2026'));
  it('tolerates timestamps and junk', () => {
    expect(formatDate('2026-11-16T10:00:00Z')).toBe('16.11.2026');
    expect(formatDate('')).toBe('');
  });
});

describe('placeLabel', () => {
  it('shows the place number', () => {
    expect(placeLabel(1)).toBe('1');
    expect(placeLabel(9)).toBe('9');
    expect(placeLabel(129)).toBe('129');
  });
});

describe('formatPoints / formatDelta', () => {
  it('points keep at most one decimal', () => {
    expect(formatPoints(1000)).toBe('1,000');
    expect(formatPoints(12.5)).toBe('12.5');
  });
  it('delta has a sign, empty for zero', () => {
    expect(formatDelta(540)).toBe('+540');
    expect(formatDelta(-235)).toBe('−235');
    expect(formatDelta(0)).toBe('');
  });
});

describe('isAffected', () => {
  const eng = (ids: number[]) => ({ results: ids.map((competitionId) => ({ result: { competitionId } })) });
  it('delta or a result from an added competition', () => {
    expect(isAffected({ delta: 5, engine: null }, new Set())).toBe(true);
    expect(isAffected({ delta: 0, engine: eng([1, 3159]) }, new Set([3159]))).toBe(true);
    expect(isAffected({ delta: 0, engine: eng([1]) }, new Set([3159]))).toBe(false);
    expect(isAffected({ delta: 0, engine: null }, new Set([3159]))).toBe(false);
  });
});
