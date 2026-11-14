// Nightly data build: discover competitions, load new/changed ones, fetch the official ranking, validate the
// engine against it and write the site's data files (public/data). Run with `npm run pipeline`.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getCompetitionInfo, getCompetitionList, getOfficialRanking, getWrlCurrent, getWrlHistory, type RawRankingRow,
} from '../data/ijf-api';
import { OLYMPIC_PAGE_URL } from '../data/olympic-page';
import { loadCompetition } from '../data/competition-loader';
import { PLACINGS_VERSION } from '../engine/placings';
import { AGE_GENDERS, ID_AGE, type AgeGender } from '../data/ids';
import type { AgeGroup, AthleteResult, CompetitionMeta, Person } from '../engine/types';
import type { OfficialEntry } from '../engine/projection';
import { discoverCompetitions, emptyIndex, type CompetitionIndex } from './discover';
import { findOfficialDates, guardOfficial, toOfficialEntries } from './official';
import {
  chooseOfficialDates, engineAtDates, officialPlaceLookup, summarise, validate, type Validation, type ValidationFile,
} from './validate';
import { daysBetween, mapLimit, mondayOnOrBefore, readJson, withRetry, writeJson } from './util';
import { olympicStep, type OlympicOfficialFile, type OlympicValidation } from './olympic';

/** A stored competition ended fewer than this many days ago is refetched every run (late corrections). */
export const RECENT_DAYS = 14;
/** Competitions loaded in parallel; each load makes 3 API calls, so at most 6 requests are in flight. */
const LOAD_CONCURRENCY = 2;
const INFO_CONCURRENCY = 6;
const AGES: AgeGroup[] = ['sen', 'jun', 'cad'];

export interface RunOptions {
  outDir: string; // public/data
  cacheDir: string; // data-cache
  today?: string; // YYYY-MM-DD, default: current UTC date
  now?: Date; // for generatedAt
  retryDelayMs?: number; // backoff base: retries wait 1x, 2x this
  log?: (msg: string) => void;
}

export interface RunSummary {
  competitions: Record<AgeGroup, number>;
  loaded: number[];
  kept: number[]; // fresh load had fewer/no results than stored: stored data kept
  failed: number[]; // load failed after retries: skipped this run (stored data kept)
  personsWithoutContinent: number;
  officialDates: Record<AgeGender, string>;
  validation: Validation;
  olympic: OlympicValidation;
  /** Also written to validation.json: official lists kept from the previous run, distrusted dates, failed calls. */
  warnings: string[];
}

/** One competition's derived data, as stored in data-cache/competitions/<id>.json (version = PLACINGS_VERSION). */
export interface StoredCompetition { updatedAt: string; version?: number; results: AthleteResult[]; persons: Person[] }

export type MetaFile = {
  generatedAt: string;
  officialDates: Record<AgeGender, string>;
  competitions: (CompetitionMeta & { hasResults: boolean })[];
};

const finishedCount = (rs: AthleteResult[]) => rs.filter((r) => r.categoryFinished).length;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortResults = (rs: AthleteResult[]) =>
  [...rs].sort((a, b) => cmp(a.gender, b.gender) || cmp(a.weight, b.weight) || a.place - b.place || a.idPerson - b.idPerson);

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function fetchBreakdownHtml(idPerson: number): Promise<string> {
  const res = await fetch(`https://www.ijf.org/judoka/${idPerson}/wrl`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`breakdown ${idPerson}: HTTP ${res.status}`);
  return res.text();
}

export async function runPipeline(opts: RunOptions): Promise<RunSummary> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const log = opts.log ?? ((m: string) => console.log(m));
  const delay = opts.retryDelayMs ?? 1000;
  const retry = <T>(fn: () => Promise<T>) => withRetry(fn, 2, delay);
  const indexPath = join(opts.cacheDir, 'competition-index.json');
  const storedPath = (id: number) => join(opts.cacheDir, 'competitions', `${id}.json`);

  // 1. discover
  const index = (await readJson<CompetitionIndex>(indexPath)) ?? emptyIndex();
  const metas = await discoverCompetitions(index, (id) => retry(() => getCompetitionInfo(id)), {
    fetchList: (y) => retry(() => getCompetitionList(y)), today, concurrency: INFO_CONCURRENCY, log,
  });
  await writeJson(indexPath, index);
  log(`discovered ${metas.length} competitions (${AGES.map((a) => `${a} ${metas.filter((m) => m.age === a).length}`).join(', ')})`);

  // 2. load new and changed competitions
  const loaded: number[] = [];
  const kept: number[] = [];
  const failed: number[] = [];
  const stored = new Map<number, StoredCompetition>();
  for (const m of metas) {
    const s = await readJson<StoredCompetition>(storedPath(m.id));
    if (s) stored.set(m.id, s);
  }
  const toLoad = metas.filter((m) => {
    if (m.dateFrom > today) return false;
    const s = stored.get(m.id);
    return !s || s.updatedAt !== index.competitions[String(m.id)]?.updatedAt || s.version !== PLACINGS_VERSION
      || daysBetween(m.dateTo, today) < RECENT_DAYS;
  });
  log(`loading ${toLoad.length} competitions`);
  let done = 0;
  await mapLimit(toLoad, LOAD_CONCURRENCY, async (m) => {
    if (++done % 25 === 0) log(`  loading ${done}/${toLoad.length}`);
    let fresh: { results: AthleteResult[]; persons: Person[] };
    try {
      fresh = await retry(() => loadCompetition(m));
    } catch (e) {
      failed.push(m.id);
      log(`competition ${m.id} ${m.code} failed, skipped this run: ${e instanceof Error ? e.message : e}`);
      return;
    }
    // Never replace stored results with an empty set, nor (same derivation rules) with fewer finished results:
    // that is an API hiccup, not a correction. A new PLACINGS_VERSION may legitimately drop results.
    const old = stored.get(m.id);
    const fewer = old?.version === PLACINGS_VERSION && finishedCount(fresh.results) < finishedCount(old.results);
    if (old && (fresh.results.length === 0 || fewer)) {
      kept.push(m.id);
      log(`competition ${m.id} ${m.code}: fresh load has ${fresh.results.length} results (${finishedCount(fresh.results)} finished), stored has ${old.results.length} (${finishedCount(old.results)}): kept stored`);
      return;
    }
    if (fresh.results.length === 0) return; // nothing yet: not stored, so the next run tries again
    const s: StoredCompetition = {
      updatedAt: index.competitions[String(m.id)]?.updatedAt ?? '',
      version: PLACINGS_VERSION,
      results: sortResults(fresh.results),
      persons: [...fresh.persons].sort((a, b) => a.id - b.id),
    };
    stored.set(m.id, s);
    await writeJson(storedPath(m.id), s);
    loaded.push(m.id);
  });
  for (const list of [loaded, kept, failed]) list.sort((a, b) => a - b);

  // 3. official ranking, one call per list (getOfficialRanking throws on a truncated answer); a missing or shrunken
  // list keeps the previously published file. wrl_history gives a first estimate of each list's date.
  const warnings: string[] = [];
  const rows: RawRankingRow[] = [];
  for (const ag of AGE_GENDERS) {
    try {
      rows.push(...(await retry(() => getOfficialRanking(ID_AGE[ag]))));
    } catch (e) {
      warnings.push(`${ag}: ranking.get_list failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  const previousOfficial: Partial<Record<AgeGroup, OfficialEntry[]>> = {};
  for (const age of AGES) {
    const prev = await readJson<OfficialEntry[]>(join(opts.outDir, `official-${age}.json`));
    if (prev) previousOfficial[age] = prev;
  }
  const guarded = guardOfficial(toOfficialEntries(rows), previousOfficial);
  warnings.push(...guarded.warnings);
  const { official } = guarded;
  const found = await findOfficialDates(official, {
    wrlHistory: (id) => retry(() => getWrlHistory(id)), breakdownHtml: (id) => retry(() => fetchBreakdownHtml(id)), log,
  });
  const previous = await readJson<MetaFile>(join(opts.outDir, 'meta.json'));
  const historyDates = {} as Record<AgeGender, string>;
  for (const ag of AGE_GENDERS) {
    const d = found[ag] ?? previous?.officialDates?.[ag] ?? mondayOnOrBefore(today);
    if (!found[ag]) warnings.push(`${ag}: no wrl_history/breakdown date for the list; starting from ${d}`);
    historyDates[ag] = d;
  }

  // 4. assemble
  const comps = new Map(metas.map((m) => [m.id, m]));
  const allResults: AthleteResult[] = [];
  const resultsByAge: Record<AgeGroup, Record<string, AthleteResult[]>> = { sen: {}, jun: {}, cad: {} };
  const persons = new Map<number, Person>();
  for (const m of metas) {
    const s = stored.get(m.id);
    if (!s?.results.length) continue;
    resultsByAge[m.age][String(m.id)] = s.results;
    allResults.push(...s.results);
    const inResults = new Set(s.results.map((r) => r.idPerson));
    for (const p of s.persons) {
      if (!inResults.has(p.id)) continue;
      // metas are in date order: the latest competition's name and country win
      const prev = persons.get(p.id);
      persons.set(p.id, { ...p, name: p.name || prev?.name || '', continent: p.continent || prev?.continent || '' });
    }
  }
  const continentOf = new Map<string, string>();
  for (const p of persons.values()) if (p.continent && p.country) continentOf.set(p.country, p.continent);
  let personsWithoutContinent = 0;
  for (const p of persons.values()) {
    if (!p.continent) p.continent = continentOf.get(p.country) ?? '';
    if (!p.continent) personsWithoutContinent++;
  }

  // the list can be newer than wrl_history: take the Monday that the engine matches best, never going back
  const engine = engineAtDates(allResults, comps, officialPlaceLookup(official));
  const choice = chooseOfficialDates({
    history: historyDates, previous: previous?.officialDates ?? {}, today, official, engine, log,
  });
  warnings.push(...choice.warnings);
  const officialDates = choice.dates;
  const report = validate(official, officialDates, engine);
  const { validation } = report;

  // 5. Olympic ranking (LA28): official Olympic points, their list date, engine and status agreement
  const olympic = await olympicStep({
    results: allResults, comps, officialPlace: officialPlaceLookup(official), persons, today,
    previous: await readJson<OlympicOfficialFile>(join(opts.outDir, 'olympic-official.json')),
    wrlCurrent: (id) => getWrlCurrent(id), pageHtml: (g) => fetchText(OLYMPIC_PAGE_URL[g]), retryDelayMs: delay, log,
  });
  warnings.push(...olympic.warnings);

  // 6. write
  const meta: MetaFile = {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    officialDates,
    competitions: metas.map((m) => ({ ...m, hasResults: !!stored.get(m.id)?.results.length })),
  };
  await writeJson(join(opts.outDir, 'meta.json'), meta);
  for (const age of AGES) {
    await writeJson(join(opts.outDir, `results-${age}.json`), resultsByAge[age]);
    await writeJson(join(opts.outDir, `official-${age}.json`), official.filter((o: OfficialEntry) => o.category.startsWith(`${age}-`)));
  }
  await writeJson(join(opts.outDir, 'persons.json'), Object.fromEntries([...persons].sort((a, b) => a[0] - b[0])));
  await writeJson(join(opts.outDir, 'olympic-official.json'), olympic.file);
  const validationFile: ValidationFile = { ...validation, olympic: olympic.validation, warnings };
  await writeJson(join(opts.outDir, 'validation.json'), validationFile);

  const competitions = Object.fromEntries(AGES.map((a) => [a, metas.filter((m) => m.age === a).length])) as Record<AgeGroup, number>;
  log(`competitions: ${AGES.map((a) => `${a} ${competitions[a]} (with results ${Object.keys(resultsByAge[a]).length})`).join(', ')}`);
  log(`loaded ${loaded.length}, kept stored ${kept.length}${kept.length ? ` [${kept.join(', ')}]` : ''}, failed ${failed.length}${failed.length ? ` [${failed.join(', ')}]` : ''}`);
  log(`official dates: ${AGE_GENDERS.map((ag) => `${ag} ${officialDates[ag]}`).join(', ')}`);
  log(`persons: ${persons.size}, without continent: ${personsWithoutContinent}`);
  for (const line of summarise(report)) log(`validation ${line}`);
  for (const w of warnings) log(`WARNING ${w}`);
  return { competitions, loaded, kept, failed, personsWithoutContinent, officialDates, validation, olympic: olympic.validation, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = Date.now();
  runPipeline({ outDir: join('public', 'data'), cacheDir: 'data-cache' })
    .then(() => console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
