import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { officialCategory } from '../../src/data/ids';
import { extractPersons, normaliseDate, toCompetitionMeta } from '../../src/data/competition-loader';
import { latestVersion } from '../../src/pipeline/official';

describe('officialCategory', () => {
  it('maps ranking.get_list id_age/id_weight to category keys', () => {
    expect(officialCategory('1', '1')).toBe('sen-m-60');
    expect(officialCategory(1, 7)).toBe('sen-m+100');
    expect(officialCategory(2, 8)).toBe('sen-f-48');
    expect(officialCategory(2, 14)).toBe('sen-f+78');
    expect(officialCategory(7, 44)).toBe('jun-m-60');
    expect(officialCategory(8, 58)).toBe('jun-f+78');
    expect(officialCategory(9, 60)).toBe('cad-m-50');
    expect(officialCategory(9, 67)).toBe('cad-m+90');
    expect(officialCategory(10, 68)).toBe('cad-f-40');
    expect(officialCategory(10, 75)).toBe('cad-f+70');
    expect(officialCategory(1, 8)).toBeNull();
    expect(officialCategory(3, 1)).toBeNull();
  });

  it('maps every row of the ranking fixture', () => {
    const feed = JSON.parse(readFileSync('tests/fixtures/ranking.json', 'utf8')).feed as { id_age: string; id_weight: string }[];
    expect(feed.filter((r) => officialCategory(r.id_age, r.id_weight) === null)).toEqual([]);
  });
});

describe('latestVersion', () => {
  it('reads the newest version of the age as the Monday of its ISO week', () => {
    const h = ['world_ranking_sen_2026_9', 'world_ranking_sen_2026_45', 'world_ranking_jun_2026_46', 'world_ranking_sen_2025_52']
      .map((version, i) => ({ version, sum_points: String(i), place: '1', age: '', weight: '' }));
    expect(latestVersion(h, 'sen')).toEqual({ date: '2026-11-02', points: 1 }); // fixture: "Ranked on Nov 2, 2026"
    expect(latestVersion(h, 'cad')).toBeNull();
  });
});

describe('competition loader helpers', () => {
  it('normalises both API date formats', () => {
    expect(normaliseDate('2026/11/13')).toBe('2026-11-13');
    expect(normaliseDate('2026-10-29')).toBe('2026-10-29');
  });

  it('builds CompetitionMeta from a list row', () => {
    expect(toCompetitionMeta({ id_competition: '3159', competition_code: 'gp_cro2026', name: 'Zagreb GP', date_from: '2026/11/13', date_to: '2026/11/15', country_short: 'CRO' }))
      .toEqual({ id: 3159, code: 'gp_cro2026', name: 'Zagreb GP', dateFrom: '2026-11-13', dateTo: '2026-11-15', age: 'sen', eventType: 'grand_prix', hostCountry: 'CRO' });
    expect(toCompetitionMeta({ id_competition: 1, competition_code: 'kata_esp2026', name: 'k', date_from: '2026-01-01', date_to: '2026-01-01' })).toBeNull();
  });

  it('extracts every entrant as a person, continent through the country', () => {
    const d = (f: string) => JSON.parse(readFileSync(`tests/fixtures/competitions/3157/${f}.json`, 'utf8'));
    const persons = extractPersons(d('contests').contests, d('competitors'), d('results'));
    const by = new Map(persons.map((p) => [p.id, p]));
    expect(by.get(20144)).toEqual({ id: 20144, name: 'AGHAYEV Balabay', country: 'AZE', continent: 'Europe' });
    expect(by.get(3712)).toMatchObject({ name: 'SMETOV Yeldos', country: 'KAZ' });
    expect(persons.length).toBeGreaterThan(300);
  });
});
