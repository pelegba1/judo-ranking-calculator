import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline } from '../../src/pipeline/run';
import { PLACINGS_VERSION } from '../../src/engine/placings';
import type { AthleteResult } from '../../src/engine/types';

// Fixture competitions: 3151 wc_sen2026, 3157 gs_uae2026, 3159 gp_cro2026 (running: Nov 13-15),
// 3177 cont_cup_jun_kaz2026, 3191 cont_cup_cad_aze2026.
const FIX = join(import.meta.dirname, '..', 'fixtures');
const DIRS: Record<number, string> = { 3151: '3151', 3157: '3157', 3159: 'partial-3159', 3177: '3177', 3191: '3191' };
const SENIOR_LISTED = [3151, 3157, 3159];
const TODAY = '2026-11-14';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const fixture = (id: number, f: string) => read(join(FIX, 'competitions', DIRS[id], `${f}.json`));

type RankingRow = { id_person: string; id_age: string; id_weight: string; place: string; sum_points: string };
let ranking: { feed: RankingRow[] };
beforeAll(() => {
  ranking = read(join(FIX, 'ranking.json'));
});

const AGE_OF_ID: Record<string, string> = { 1: 'sen', 2: 'sen', 7: 'jun', 8: 'jun', 9: 'cad', 10: 'cad' };

interface FakeApi {
  calls: { action: string; id?: number }[];
  /** Return a Response to override the fixture answer for one call. */
  override?: (action: string, id: number | undefined) => Response | undefined;
  infoTs: Record<number, string>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function installFakeApi(api: FakeApi) {
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    const p = (k: string) => url.searchParams.get(`params[${k}]`);
    const action = p('action') ?? '';
    const id = p('id_competition') ? Number(p('id_competition')) : undefined;
    api.calls.push({ action, id });
    const o = api.override?.(action, id);
    if (o) return o;
    const info = (cid: number) => ({ ...fixture(cid, 'info'), updated_at_ts: api.infoTs[cid] ?? fixture(cid, 'info').updated_at_ts });
    switch (action) {
      case 'competition.get_list': {
        if (p('year') !== '2026') return json([]);
        return json(SENIOR_LISTED.map((cid) => {
          const i = info(cid);
          return { ...i, date_from: i.date_from.replace(/-/g, '/'), date_to: i.date_to.replace(/-/g, '/') };
        }));
      }
      case 'competition.info':
        return id! in DIRS ? json(info(id!)) : json({ error: 'info.error.id_competition_not_exists' });
      case 'contest.find':
        return json(fixture(id!, 'contests'));
      case 'competition.competitors':
        return json(fixture(id!, 'competitors'));
      case 'competition.results':
        return json(fixture(id!, 'results'));
      case 'ranking.get_list':
        return json(ranking);
      case 'competitor.wrl_history': {
        const rows = ranking.feed.filter((r) => r.id_person === p('id_person'));
        return json(rows.map((r) => {
          const age = AGE_OF_ID[r.id_age];
          // seniors ranked on Mon 2026-11-02 (week 45), juniors/cadets on Mon 2026-10-26 (week 44)
          return { version: `world_ranking_${age}_2026_${age === 'sen' ? 45 : 44}`, sum_points: r.sum_points, place: r.place, age, weight: '' };
        }));
      }
      default:
        return json({ error: `unknown action ${action}` });
    }
  });
}

function newApi(partial: Partial<FakeApi> = {}): FakeApi {
  return { calls: [], infoTs: {}, ...partial };
}

let dirs: string[] = [];
function tempDirs() {
  const root = mkdtempSync(join(tmpdir(), 'jrc-run-'));
  dirs.push(root);
  return { outDir: join(root, 'public', 'data'), cacheDir: join(root, 'data-cache') };
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const opts = (d: { outDir: string; cacheDir: string }) => ({
  ...d, today: TODAY, now: new Date('2026-11-14T03:00:00Z'), retryDelayMs: 0, log: () => {},
});
const loadedIds = (api: FakeApi) =>
  [...new Set(api.calls.filter((c) => c.action === 'contest.find').map((c) => c.id))].sort();

describe('runPipeline on fixtures', () => {
  it('writes meta, results, official, persons and validation files with the contract shapes', async () => {
    const d = tempDirs();
    installFakeApi(newApi());
    await runPipeline(opts(d));

    const meta = read(join(d.outDir, 'meta.json'));
    expect(meta.generatedAt).toBe('2026-11-14T03:00:00.000Z');
    expect(meta.officialDates).toEqual({
      'sen-m': '2026-11-02', 'sen-f': '2026-11-02', 'jun-m': '2026-10-26', 'jun-f': '2026-10-26',
      'cad-m': '2026-10-26', 'cad-f': '2026-10-26',
    });
    const byId = new Map<number, Record<string, unknown>>(meta.competitions.map((c: { id: number }) => [c.id, c]));
    expect(byId.get(3157)).toEqual({
      id: 3157, code: 'gs_uae2026', name: 'Abu Dhabi Grand Slam 2026', dateFrom: '2026-10-29', dateTo: '2026-10-31',
      age: 'sen', eventType: 'grand_slam', hostCountry: 'UAE', hasResults: true,
    });
    expect(byId.get(3191)).toMatchObject({ age: 'cad', eventType: 'continental_cup', hasResults: true });
    expect(byId.get(3177)).toMatchObject({ age: 'jun', eventType: 'continental_cup', hasResults: true });
    expect(byId.get(3159)).toMatchObject({ age: 'sen', eventType: 'grand_prix', hasResults: true });

    const sen: Record<string, AthleteResult[]> = read(join(d.outDir, 'results-sen.json'));
    expect(Object.keys(sen).sort()).toEqual(['3151', '3157', '3159']);
    expect(sen['3157'].find((r) => r.idPerson === 20144)).toEqual({
      competitionId: 3157, idPerson: 20144, gender: 'm', weight: '-60', place: 1, wins: expect.any(Number),
      country: 'AZE', categoryFinished: true,
    });
    expect(Object.keys(read(join(d.outDir, 'results-jun.json')))).toEqual(['3177']);
    expect(Object.keys(read(join(d.outDir, 'results-cad.json')))).toEqual(['3191']);

    const official = read(join(d.outDir, 'official-sen.json'));
    expect(official[0]).toEqual({ idPerson: 20144, category: 'sen-m-60', place: 1, points: 5473 });
    expect(read(join(d.outDir, 'official-cad.json')).every((e: { category: string }) => e.category.startsWith('cad-'))).toBe(true);
    expect(read(join(d.outDir, 'official-jun.json')).length).toBeGreaterThan(100);

    const persons = read(join(d.outDir, 'persons.json'));
    expect(persons['20144']).toEqual({ id: 20144, name: 'AGHAYEV Balabay', country: 'AZE', continent: 'Europe' });

    const validation = read(join(d.outDir, 'validation.json'));
    for (const age of ['sen', 'jun', 'cad']) {
      const v = validation[age];
      expect(v.checked).toBeGreaterThan(100);
      expect(v.matched).toBeGreaterThanOrEqual(0);
      expect(v.matched).toBeLessThanOrEqual(v.checked);
      expect(v.mismatches.length).toBeLessThanOrEqual(200);
      expect(v.mismatches.length).toBe(Math.min(200, v.checked - v.matched));
      for (const m of v.mismatches) expect(Object.keys(m).sort()).toEqual(['category', 'engine', 'idPerson', 'official']);
    }
  });

  it('does not refetch a stored competition unless updated_at_ts changed or it ended < 14 days ago', async () => {
    const d = tempDirs();
    installFakeApi(newApi());
    await runPipeline(opts(d));

    const second = newApi();
    installFakeApi(second);
    await runPipeline(opts(d));
    expect(loadedIds(second)).toEqual([3159]); // only the running event

    const third = newApi({ infoTs: { 3151: '1999999999', 3191: '1999999999' } });
    installFakeApi(third);
    await runPipeline(opts(d));
    expect(loadedIds(third)).toEqual([3151, 3159, 3191]);
  });

  it('refetches a stored competition derived by an older placings version', async () => {
    const d = tempDirs();
    installFakeApi(newApi());
    await runPipeline(opts(d));
    const path = join(d.cacheDir, 'competitions', '3151.json');
    const stored = read(path);
    expect(stored.version).toBe(PLACINGS_VERSION);
    writeFileSync(path, JSON.stringify({ ...stored, version: PLACINGS_VERSION - 1 }));

    const again = newApi();
    installFakeApi(again);
    await runPipeline(opts(d));
    expect(loadedIds(again)).toEqual([3151, 3159]);
    expect(read(path).version).toBe(PLACINGS_VERSION);
  });

  it('keeps stored results when a fresh load returns no results (Review Focus 4)', async () => {
    const d = tempDirs();
    installFakeApi(newApi());
    await runPipeline(opts(d));
    const before = read(join(d.outDir, 'results-sen.json'))['3159'];
    expect(before.length).toBeGreaterThan(0);

    installFakeApi(newApi({
      override: (action, id) => {
        if (id !== 3159) return undefined;
        if (action === 'contest.find') return json({ contests: [] });
        if (action === 'competition.competitors') return json({ categories: {} });
        if (action === 'competition.results') return json({ by_categories: {} });
        return undefined;
      },
    }));
    await runPipeline(opts(d));
    expect(read(join(d.outDir, 'results-sen.json'))['3159']).toEqual(before);
    expect(read(join(d.cacheDir, 'competitions', '3159.json')).results).toEqual(before);
  });

  it('skips a competition that keeps failing, keeps its stored data and finishes the run', async () => {
    const d = tempDirs();
    installFakeApi(newApi());
    await runPipeline(opts(d));
    const before = read(join(d.outDir, 'results-sen.json'))['3159'];

    const failing = newApi({ override: (action, id) => (id === 3159 && action === 'contest.find' ? new Response('x', { status: 500 }) : undefined) });
    installFakeApi(failing);
    const summary = await runPipeline(opts(d));
    expect(summary.failed).toEqual([3159]);
    expect(failing.calls.filter((c) => c.action === 'contest.find' && c.id === 3159)).toHaveLength(3); // 1 + 2 retries
    expect(read(join(d.outDir, 'results-sen.json'))['3159']).toEqual(before);

    // a fresh run with the same failure: no stored data, the competition is just missing
    const d2 = tempDirs();
    installFakeApi(newApi({ override: failing.override }));
    const s2 = await runPipeline(opts(d2));
    expect(s2.failed).toEqual([3159]);
    expect(read(join(d2.outDir, 'results-sen.json'))['3159']).toBeUndefined();
    expect(read(join(d2.outDir, 'meta.json')).competitions.find((c: { id: number }) => c.id === 3159).hasResults).toBe(false);
  });

  it('writes byte-identical public data on an unchanged rerun (apart from generatedAt)', async () => {
    const d = tempDirs();
    installFakeApi(newApi());
    await runPipeline(opts(d));
    const files = ['results-sen.json', 'official-sen.json', 'persons.json', 'validation.json', 'meta.json'];
    const snap = files.map((f) => readFileSync(join(d.outDir, f), 'utf8'));
    installFakeApi(newApi());
    await runPipeline(opts(d));
    expect(files.map((f) => readFileSync(join(d.outDir, f), 'utf8'))).toEqual(snap);
  });
});
