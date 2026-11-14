import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AthleteResult, CompetitionMeta } from '../../src/engine/types';

const loadCompetition = vi.fn();
vi.mock('../../src/data/competition-loader', async (orig) => ({
  ...(await orig<typeof import('../../src/data/competition-loader')>()),
  loadCompetition: (...a: unknown[]) => loadCompetition(...a),
}));

const { DataStore } = await import('../../src/web/state/useData');

const gp: CompetitionMeta = { id: 7, code: 'gp', name: 'GP', dateFrom: '2026-11-13', dateTo: '2026-11-15', age: 'sen', eventType: 'grand_prix', hostCountry: '' };
const r = (idPerson: number, weight: string, categoryFinished: boolean): AthleteResult =>
  ({ competitionId: 7, idPerson, gender: 'm', weight, place: 1, wins: 1, country: 'FRA', categoryFinished });
const nightly = [r(1, '-60', true), r(2, '-66', true), r(3, '-73', false)];

function stubFiles(results: Record<string, AthleteResult[]>) {
  const files: Record<string, unknown> = { 'data/official-sen.json': [], 'data/results-sen.json': results };
  vi.stubGlobal('fetch', async (url: string) =>
    url in files ? new Response(JSON.stringify(files[url])) : new Response('missing', { status: 404 }));
}

describe('DataStore.loadLive', () => {
  beforeEach(() => { loadCompetition.mockReset(); stubFiles({ 7: nightly }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('an empty live load keeps the nightly results (fallback)', async () => {
    const store = new DataStore();
    loadCompetition.mockResolvedValue({ results: [], persons: [] });
    expect((await store.loadLive(gp)).status).toBe('fallback');
    expect(store.live.get(7)).toEqual({ status: 'fallback' });
  });

  it('a live load with fewer finished categories than the nightly one keeps the nightly results', async () => {
    const store = new DataStore();
    loadCompetition.mockResolvedValue({ results: [r(1, '-60', true), r(2, '-66', false), r(3, '-73', false)], persons: [] });
    expect((await store.loadLive(gp)).status).toBe('fallback');
  });

  it('a live load with at least as many finished categories replaces the nightly results', async () => {
    const store = new DataStore();
    const fresh = [r(1, '-60', true), r(2, '-66', true), r(3, '-73', true)];
    loadCompetition.mockResolvedValue({ results: fresh, persons: [] });
    const s = await store.loadLive(gp);
    expect(s).toEqual({ status: 'ready', results: fresh });
    expect(store.liveVersion).toBe(1);
  });

  it('without nightly results for the competition, any live load is used (even empty)', async () => {
    stubFiles({});
    const store = new DataStore();
    loadCompetition.mockResolvedValue({ results: [], persons: [] });
    expect(await store.loadLive(gp)).toEqual({ status: 'ready', results: [] });
  });

  it('a second call while a load is in flight waits for that same load', async () => {
    const store = new DataStore();
    let finish!: (v: unknown) => void;
    loadCompetition.mockReturnValue(new Promise((res) => { finish = res; }));
    const first = store.loadLive(gp);
    const second = store.loadLive(gp);
    expect(store.live.get(7)).toEqual({ status: 'loading' });
    finish({ results: [], persons: [] });
    expect((await second).status).toBe('fallback');
    expect(await first).toEqual(await second);
    expect(loadCompetition).toHaveBeenCalledTimes(1);
  });
});
