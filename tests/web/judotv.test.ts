import { describe, it, expect } from 'vitest';
import { parseJudoTvUrl, resolveCompetition, yearOfCode } from '../../src/web/judotv';
import type { RawCompetition } from '../../src/data/ijf-api';
import type { CompetitionMeta } from '../../src/engine/types';

describe('parseJudoTvUrl', () => {
  it.each([
    'https://www.judotv.com/competitions/gp_cro2026/overview',
    'http://judotv.com/competitions/gp_cro2026',
    'https://www.judotv.com/competitions/gp_cro2026/results/m-60?x=1',
    'judotv.com/competitions/gp_cro2026/',
    '  https://WWW.JudoTV.com/competitions/GP_CRO2026#top  ',
  ])('%s -> gp_cro2026', (url) => {
    expect(parseJudoTvUrl(url)).toEqual({ code: 'gp_cro2026' });
  });

  it('a bare competition code is accepted', () => {
    expect(parseJudoTvUrl('gp_cro2026')).toEqual({ code: 'gp_cro2026' });
  });

  it.each(['https://www.ijf.org/x', 'https://notjudotv.com/competitions/gp_cro2026', '', 'hello world'])(
    '%s -> not_judotv', (url) => {
      expect(parseJudoTvUrl(url)).toEqual({ error: 'not_judotv' });
    });

  it.each(['https://www.judotv.com/videos/123', 'https://www.judotv.com/', 'https://www.judotv.com/competitions/'])(
    '%s -> no_code', (url) => {
      expect(parseJudoTvUrl(url)).toEqual({ error: 'no_code' });
    });
});

describe('yearOfCode', () => {
  it('takes the trailing four digits', () => {
    expect(yearOfCode('gp_cro2026', 2030)).toBe(2026);
    expect(yearOfCode('masters_2025', 2030)).toBe(2025);
  });
  it('falls back to the given year', () => {
    expect(yearOfCode('weird_code', 2030)).toBe(2030);
  });
});

describe('resolveCompetition', () => {
  const known: CompetitionMeta[] = [{
    id: 3159, code: 'gp_cro2026', name: 'Zagreb Grand Prix 2026', dateFrom: '2026-11-13', dateTo: '2026-11-15',
    age: 'sen', eventType: 'grand_prix', hostCountry: 'CRO',
  }];
  const row = (id: string, code: string, name: string): RawCompetition => ({
    id_competition: id, competition_code: code, name, date_from: '2026/12/05', date_to: '2026/12/06', country_short: 'JPN',
  });
  const list = async (year: number) => {
    expect(year).toBe(2026);
    return [row('3160', 'gs_jpn2026', 'Tokyo Grand Slam 2026'), row('9999', 'kata_xyz2026', 'Kata Open 2026')];
  };
  const noList = async (): Promise<RawCompetition[]> => { throw new Error('should not be called'); };

  it('finds a known competition without calling the API', async () => {
    expect(await resolveCompetition('gp_cro2026', known, noList)).toEqual({ meta: known[0] });
  });

  it('falls back to competition.get_list of the code year', async () => {
    const r = await resolveCompetition('gs_jpn2026', known, list);
    expect(r).toEqual({ meta: expect.objectContaining({ id: 3160, age: 'sen', eventType: 'grand_slam', dateTo: '2026-12-06' }) });
  });

  it('unknown code -> not_found', async () => {
    expect(await resolveCompetition('gp_xxx2026', known, list)).toEqual({ error: 'not_found' });
  });

  it('competition without ranking points -> no_points', async () => {
    expect(await resolveCompetition('kata_xyz2026', known, list)).toEqual({ error: 'no_points' });
  });

  it('list call failure -> network', async () => {
    expect(await resolveCompetition('gs_jpn2026', known, async () => { throw new Error('offline'); })).toEqual({ error: 'network' });
  });
});
