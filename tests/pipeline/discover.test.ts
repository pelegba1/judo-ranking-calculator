import { describe, it, expect } from 'vitest';
import { discoverCompetitions, emptyIndex } from '../../src/pipeline/discover';
import type { RawCompetition, RawCompetitionInfo } from '../../src/data/ijf-api';

const TODAY = '2026-11-14';

function info(id: number, code: string, from: string, to = from, country = 'XXX', ts = '1'): RawCompetitionInfo {
  return {
    id_competition: String(id), competition_code: code, external_id: code, name: `Comp ${id}`,
    date_from: from, date_to: to, country_short: country, updated_at_ts: ts,
  };
}
function listRow(id: number, code: string, from: string, to = from, ts = '1'): RawCompetition {
  return {
    id_competition: String(id), competition_code: code, name: `Comp ${id}`,
    date_from: from.replace(/-/g, '/'), date_to: to.replace(/-/g, '/'), country_short: 'HOS', updated_at_ts: ts,
  };
}

/** A fake competition.info over a fixed table; records every id asked for. */
function fakeInfo(table: Record<number, RawCompetitionInfo>) {
  const asked: number[] = [];
  const fetchInfo = async (id: number) => {
    asked.push(id);
    return table[id] ?? null;
  };
  return { fetchInfo, asked };
}

describe('discoverCompetitions', () => {
  it('stops scanning after 40 consecutive empty ids past the known maximum', async () => {
    const table: Record<number, RawCompetitionInfo> = {};
    for (let id = 1000; id <= 1010; id++) table[id] = info(id, `cont_cup_cad_x${id}`, '2026-06-01');
    table[1012] = info(1012, 'cont_cup_jun_y2026', '2026-07-01');
    const { fetchInfo, asked } = fakeInfo(table);
    const index = emptyIndex();
    index.scannedMax = 1005;
    await discoverCompetitions(index, fetchInfo, { fetchList: async () => [], today: TODAY, concurrency: 1 });
    expect(Math.min(...asked)).toBe(1005 - 50);
    expect(Math.max(...asked)).toBe(1012 + 40); // 1013..1052 empty -> stop
    expect(index.scannedMax).toBe(1012);
  });

  it('first run scans from the lowest list id dated within 26 months (minus 50) and returns classified metas', async () => {
    const table: Record<number, RawCompetitionInfo> = {
      2990: info(2990, 'cont_cup_cad_old2024', '2024-05-01'),
      3020: info(3020, 'cont_cup_cad_aze2026', '2026-04-04', '2026-04-05', 'AZE', '77'),
      3030: info(3030, 'kata_esp2026', '2026-05-01'), // unclassified
      3040: info(3040, 'wc_jun2026', '2026-10-01', '2026-10-04', 'PER'),
      3050: info(3050, 'gs_uae2026', '2026-10-29', '2026-10-31', 'UAE'),
    };
    const list = [
      listRow(3050, 'gs_uae2026', '2026-10-29', '2026-10-31', '55'),
      listRow(3000, 'gp_old2024', '2024-06-01'), // older than 26 months: not the start
      listRow(3045, 'gp_cro2024', '2024-09-20'),
    ];
    const { fetchInfo, asked } = fakeInfo(table);
    const index = emptyIndex();
    const metas = await discoverCompetitions(index, fetchInfo, {
      fetchList: async (y) => (y === 2026 ? list : []), today: TODAY,
    });
    expect(Math.min(...asked)).toBe(3045 - 50);
    expect(asked).not.toContain(2990);
    const byId = new Map(metas.map((m) => [m.id, m]));
    expect(byId.get(3020)).toEqual({
      id: 3020, code: 'cont_cup_cad_aze2026', name: 'Comp 3020', dateFrom: '2026-04-04', dateTo: '2026-04-05',
      age: 'cad', eventType: 'continental_cup', hostCountry: 'AZE',
    });
    expect(byId.get(3040)).toMatchObject({ age: 'jun', eventType: 'world_ch' });
    expect(byId.get(3050)).toMatchObject({ age: 'sen', eventType: 'grand_slam', dateFrom: '2026-10-29' });
    expect(byId.has(3030)).toBe(false);
    expect(byId.has(3000)).toBe(false); // outside the 26-month window
    expect(index.competitions['3020'].updatedAt).toBe('77');
  });

  it('scans each id once: a later run starts 50 below the highest id found', async () => {
    const table: Record<number, RawCompetitionInfo> = {};
    for (let id = 3000; id <= 3100; id += 2) table[id] = info(id, `cont_cup_jun_a${id}`, '2026-03-01');
    const list = [listRow(2999, 'gp_aaa2026', '2026-03-01')];
    const first = fakeInfo(table);
    const index = emptyIndex();
    const deps = { fetchList: async () => list, today: TODAY };
    await discoverCompetitions(index, first.fetchInfo, deps);
    expect(Math.min(...first.asked)).toBe(2999 - 50);
    expect(index.scannedMax).toBe(3100);

    const second = fakeInfo(table);
    const metas = await discoverCompetitions(index, second.fetchInfo, deps);
    expect(Math.min(...second.asked)).toBe(3050);
    expect(metas.filter((m) => m.age === 'jun')).toHaveLength(51); // older ones kept from the index
  });

  it('a failing competition list keeps the indexed competitions (later runs only)', async () => {
    const index = emptyIndex();
    index.scannedMax = 3001;
    index.competitions['3001'] = {
      id: 3001, code: 'gs_uae2026', name: 'GS', dateFrom: '2026-10-29', dateTo: '2026-10-31', hostCountry: 'UAE', updatedAt: '1',
    };
    const logs: string[] = [];
    const metas = await discoverCompetitions(index, async () => null, {
      fetchList: async () => { throw new Error('HTTP 500'); }, today: TODAY, log: (m) => logs.push(m),
    });
    expect(metas.map((m) => m.id)).toEqual([3001]);
    expect(logs.some((l) => /list .* failed/.test(l))).toBe(true);
  });

  it('keeps going when a single info call fails', async () => {
    const table: Record<number, RawCompetitionInfo> = { 3001: info(3001, 'cont_cup_jun_b2026', '2026-03-01') };
    const index = emptyIndex();
    index.scannedMax = 3000;
    const fetchInfo = async (id: number) => {
      if (id === 2999) throw new Error('boom');
      return table[id] ?? null;
    };
    const metas = await discoverCompetitions(index, fetchInfo, { fetchList: async () => [], today: TODAY });
    expect(metas.map((m) => m.id)).toEqual([3001]);
  });
});
