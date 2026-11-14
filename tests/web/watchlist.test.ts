import { describe, it, expect, afterEach, vi } from 'vitest';
import { decodeWatchlist, encodeWatchlist, loadWatchlist, saveWatchlist, WATCHLIST_KEY } from '../../src/web/state/watchlist';
import { formatHash, parseHash } from '../../src/web/state/useScenario';

afterEach(() => vi.unstubAllGlobals());

describe('watchlist encoding', () => {
  it('round-trips', () => {
    expect(decodeWatchlist(encodeWatchlist([20144, 3, 99]))).toEqual([20144, 3, 99]);
    expect(encodeWatchlist([])).toBe('');
    expect(decodeWatchlist('')).toEqual([]);
  });
  it('ignores junk and duplicates', () => {
    expect(decodeWatchlist('1,a,,3')).toEqual([1, 3]);
    expect(decodeWatchlist('1,1,-4,0,2.5,3,99999999999999999999')).toEqual([1, 3]);
  });
});

describe('watchlist storage', () => {
  const fake = (store: Record<string, string> = {}) => ({
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
  });

  it('returns [] when localStorage throws', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
    expect(loadWatchlist()).toEqual([]);
    expect(() => saveWatchlist([1])).not.toThrow();
  });
  it('returns [] when localStorage is missing or the value is corrupt', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadWatchlist()).toEqual([]);
    vi.stubGlobal('localStorage', fake({ [WATCHLIST_KEY]: '{oops' }));
    expect(loadWatchlist()).toEqual([]);
    vi.stubGlobal('localStorage', fake({ [WATCHLIST_KEY]: '[1,"x",2,2,-1]' }));
    expect(loadWatchlist()).toEqual([1, 2]);
  });
  it('saves and loads under watchlist.v1', () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', fake(store));
    saveWatchlist([5, 6]);
    expect(Object.keys(store)).toEqual(['watchlist.v1']);
    expect(loadWatchlist()).toEqual([5, 6]);
  });
});

describe('watch hash route', () => {
  it('parses #/watch with scenario params and share ids', () => {
    expect(parseHash('#/watch')).toMatchObject({ watch: true, added: [], date: null });
    expect(parseHash('#/watch?ids=1,x,3&add=3159&date=2026-11-16')).toMatchObject({
      watch: true, ids: [1, 3], added: [3159], date: '2026-11-16',
    });
    expect(parseHash('#/sen/m/-60').watch).toBeUndefined();
  });
  it('formats it back', () => {
    const h = { age: 'sen' as const, gender: 'm' as const, weight: '-60', added: [3159], date: '2026-11-16', watch: true };
    expect(formatHash(h)).toBe('#/watch?add=3159&date=2026-11-16');
    expect(formatHash({ ...h, ids: [1, 3] })).toBe('#/watch?ids=1,3&add=3159&date=2026-11-16');
    expect(formatHash({ ...h, added: [], date: null })).toBe('#/watch');
    expect(parseHash(formatHash({ ...h, ids: [1, 3] }))).toMatchObject({ watch: true, ids: [1, 3], added: [3159] });
  });
});
