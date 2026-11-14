// Data for the site: the nightly files under data/ (fetched lazily, cached in memory) and competitions loaded live
// from the IJF API. One module-level store; components read it through useData().
import { useSyncExternalStore } from 'react';
import { getCompetitionInfo } from '../../data/ijf-api';
import { loadCompetition, toCompetitionMeta } from '../../data/competition-loader';
import type { OfficialEntry } from '../../engine/projection';
import type { AgeGroup, AthleteResult, CompetitionMeta, Person } from '../../engine/types';
import type { OlympicOfficialFile } from '../../pipeline/olympic';
import type { MetaFile } from '../../pipeline/run';
import type { ValidationFile } from '../../pipeline/validate';

// The data files' shapes are the pipeline's (types only: no pipeline code reaches the web bundle).
export type { MetaFile, ValidationFile };
export interface AgeFiles { official: OfficialEntry[]; results: Record<string, AthleteResult[]> }

export type Status = 'loading' | 'ready' | 'error';
type Loadable<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error' };

export type LiveState =
  | { status: 'resolving' } // id from the URL, not in meta.json: looking it up
  | { status: 'unknown' } // id not found / gives no points
  | { status: 'loading' }
  | { status: 'ready'; results: AthleteResult[] }
  /** Loaded, but with fewer finished results than the nightly data (e.g. empty): the nightly results are used. */
  | { status: 'fallback' }
  | { status: 'failed' };

const finishedCount = (rs: AthleteResult[]) => rs.filter((r) => r.categoryFinished).length;

/** A live result set that would lose results the nightly data has (empty, or fewer finished) is not used. */
export function keepNightly(live: AthleteResult[], nightly: AthleteResult[] | undefined): boolean {
  if (!nightly?.length) return false;
  return live.length === 0 || finishedCount(live) < finishedCount(nightly);
}

/** Relative to the page (never a leading slash: the site lives under /judo-ranking-calculator/). */
async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`data/${name}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for data/${name}`);
  return (await res.json()) as T;
}

export class DataStore {
  private version = 0;
  private listeners = new Set<() => void>();
  core: Loadable<{ meta: MetaFile; validation: ValidationFile }> = { status: 'loading' };
  persons: Loadable<Map<number, Person>> = { status: 'loading' };
  private livePersons: Person[] = [];
  ages: Partial<Record<AgeGroup, Loadable<AgeFiles>>> = {};
  private agePromises = new Map<AgeGroup, Promise<void>>();
  olympic: Loadable<OlympicOfficialFile> | undefined;
  live = new Map<number, LiveState>();
  private inflight = new Map<number, Promise<LiveState>>();
  /** Bumped whenever a live result set arrives (projection inputs depend on it, not on loading states). */
  liveVersion = 0;
  /** Competitions resolved live that meta.json does not list. */
  extra = new Map<number, CompetitionMeta>();
  private started = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.loadCore();
    this.loadPersons();
  }

  loadCore() {
    this.core = { status: 'loading' };
    Promise.all([fetchJson<MetaFile>('meta.json'), fetchJson<ValidationFile>('validation.json')])
      .then(([meta, validation]) => { this.core = { status: 'ready', value: { meta, validation } }; })
      .catch(() => { this.core = { status: 'error' }; })
      .finally(() => this.emit());
  }

  loadPersons() {
    this.persons = { status: 'loading' };
    fetchJson<Record<string, Person>>('persons.json')
      .then((obj) => {
        const m = new Map<number, Person>(Object.values(obj).map((p) => [p.id, p]));
        for (const p of this.livePersons) mergePerson(m, p);
        this.persons = { status: 'ready', value: m };
      })
      .catch(() => { this.persons = { status: 'error' }; })
      .finally(() => this.emit());
  }

  /** Retry after an error (from an event handler). */
  retry() {
    if (this.core.status === 'error') this.loadCore();
    if (this.persons.status === 'error') this.loadPersons();
    if (this.olympic?.status === 'error') {
      this.olympic = undefined;
      this.ensureOlympic();
    }
    for (const age of Object.keys(this.ages) as AgeGroup[]) {
      if (this.ages[age]?.status === 'error') {
        delete this.ages[age];
        this.ensureAge(age);
      }
    }
    this.emit();
  }

  /** Starts loading official-<age>.json and results-<age>.json, once. Safe to call during render (no emit). */
  ensureAge(age: AgeGroup) {
    if (this.ages[age]) return;
    this.ages[age] = { status: 'loading' };
    const p = Promise.all([fetchJson<OfficialEntry[]>(`official-${age}.json`), fetchJson<Record<string, AthleteResult[]>>(`results-${age}.json`)])
      .then(([official, results]) => { this.ages[age] = { status: 'ready', value: { official, results } }; })
      .catch(() => { this.ages[age] = { status: 'error' }; })
      .finally(() => this.emit());
    this.agePromises.set(age, p);
  }

  /** The nightly results of a competition (waits for its age group's files); undefined if none or unavailable. */
  private async nightlyOf(meta: CompetitionMeta): Promise<AthleteResult[] | undefined> {
    this.ensureAge(meta.age);
    await this.agePromises.get(meta.age);
    const a = this.ages[meta.age];
    return a?.status === 'ready' ? a.value.results[meta.id] : undefined;
  }

  /** Starts loading olympic-official.json, once. Safe to call during render (no emit). */
  ensureOlympic() {
    if (this.olympic) return;
    this.olympic = { status: 'loading' };
    fetchJson<OlympicOfficialFile>('olympic-official.json')
      .then((value) => { this.olympic = { status: 'ready', value }; })
      .catch(() => { this.olympic = { status: 'error' }; })
      .finally(() => this.emit());
  }

  private addPersons(ps: Person[]) {
    this.livePersons.push(...ps);
    if (this.persons.status === 'ready') {
      const m = new Map(this.persons.value);
      for (const p of ps) mergePerson(m, p);
      this.persons = { status: 'ready', value: m };
    }
  }

  addExtra(meta: CompetitionMeta) {
    if (this.extra.has(meta.id)) return;
    this.extra.set(meta.id, meta);
    this.emit();
  }

  /**
   * Loads a competition live from the IJF API (call from effects/handlers). Never throws; the outcome goes to `live`.
   * A call while a load of the same competition is in flight returns that load. A live set with fewer finished
   * results than the nightly one (e.g. empty) is not used: the state is `fallback` and the nightly results stay.
   */
  loadLive(meta: CompetitionMeta): Promise<LiveState> {
    const cur = this.inflight.get(meta.id);
    if (cur) return cur;
    const p = this.doLoadLive(meta).finally(() => this.inflight.delete(meta.id));
    this.inflight.set(meta.id, p);
    return p;
  }

  private async doLoadLive(meta: CompetitionMeta): Promise<LiveState> {
    const wasReady = this.live.get(meta.id)?.status === 'ready';
    this.live.set(meta.id, { status: 'loading' });
    this.emit();
    const nightly = this.nightlyOf(meta);
    let next: LiveState;
    try {
      const { results, persons } = await loadCompetition(meta);
      this.addPersons(persons);
      next = keepNightly(results, await nightly) ? { status: 'fallback' } : { status: 'ready', results };
    } catch {
      next = { status: 'failed' };
    }
    // The projection's live inputs change when a result set arrives or a previous one is dropped.
    if (next.status === 'ready' || wasReady) this.liveVersion++;
    this.live.set(meta.id, next);
    this.emit();
    return next;
  }

  /** A competition id from the URL that meta.json does not list: competition.info, then a live load. */
  async resolveId(id: number): Promise<void> {
    if (this.live.has(id) || this.extra.has(id)) return;
    this.live.set(id, { status: 'resolving' });
    this.emit();
    let meta: CompetitionMeta | null = null;
    try {
      const info = await getCompetitionInfo(id);
      meta = info ? toCompetitionMeta(info) : null;
    } catch {
      this.live.set(id, { status: 'failed' }); // IJF unreachable: we cannot tell whether the id exists
      this.emit();
      return;
    }
    if (!meta) {
      this.live.set(id, { status: 'unknown' });
      this.emit();
      return;
    }
    this.extra.set(id, meta);
    this.live.delete(id);
    await this.loadLive(meta);
  }
}

function mergePerson(m: Map<number, Person>, p: Person) {
  const old = m.get(p.id);
  m.set(p.id, old ? { ...old, name: old.name || p.name, country: old.country || p.country } : p);
}

export const store = new DataStore();

export interface DataView {
  status: Status;
  meta: MetaFile | undefined;
  validation: ValidationFile | undefined;
  persons: Map<number, Person> | undefined;
  personsStatus: Status;
  /** Starts loading the age group's files on first call; undefined until they are in. */
  official(age: AgeGroup): OfficialEntry[] | undefined;
  results(age: AgeGroup): Record<string, AthleteResult[]> | undefined;
  ageStatus(age: AgeGroup): Status;
  /** Starts loading olympic-official.json on first call; undefined until it is in. */
  olympicOfficial(): OlympicOfficialFile | undefined;
  olympicStatus(): Status;
  live: ReadonlyMap<number, LiveState>;
  extra: ReadonlyMap<number, CompetitionMeta>;
  liveVersion: number;
  version: number;
}

export function useData(): DataView {
  store.start();
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const age = (a: AgeGroup) => {
    store.ensureAge(a);
    const s = store.ages[a]!;
    return s.status === 'ready' ? s.value : undefined;
  };
  return {
    status: store.core.status,
    meta: store.core.status === 'ready' ? store.core.value.meta : undefined,
    validation: store.core.status === 'ready' ? store.core.value.validation : undefined,
    persons: store.persons.status === 'ready' ? store.persons.value : undefined,
    personsStatus: store.persons.status,
    official: (a) => age(a)?.official,
    results: (a) => age(a)?.results,
    ageStatus: (a) => {
      store.ensureAge(a);
      return store.ages[a]!.status;
    },
    olympicOfficial: () => {
      store.ensureOlympic();
      return store.olympic!.status === 'ready' ? store.olympic!.value : undefined;
    },
    olympicStatus: () => {
      store.ensureOlympic();
      return store.olympic!.status;
    },
    live: store.live,
    extra: store.extra,
    liveVersion: store.liveVersion,
    version,
  };
}
