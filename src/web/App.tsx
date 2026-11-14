import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { store, useData, type LiveState, type MetaFile, type ValidationFile } from './state/useData';
import {
  AGES, GENDERS, addCompetitionToHash, appliesTo, buildProjection, competitionProgress, officialDateOf, pendingCompetitions,
  formatHash, resolveScenario, useScenario, withView, type ProjectionData, type Scenario, type ScenarioHash,
} from './state/useScenario';
import { parseJudoTvUrl, resolveCompetition } from './judotv';
import { AGE_LABEL, GENDER_LABEL, S, formatDate } from './strings';
import { CategoryTable } from './screens/CategoryTable';
import { AthleteBreakdown } from './screens/AthleteBreakdown';
import { WEIGHTS } from '../engine/rules/categories';
import type { AgeGroup, AthleteResult, CategoryKey, CompetitionMeta, Person } from '../engine/types';
import type { ProjectedEntry } from '../engine/projection';

type Comp = CompetitionMeta & { hasResults?: boolean };
type Notice = { kind: 'info' | 'warn' | 'error'; text: string };

/** Live results of a recent competition may differ from the nightly ones: refresh those still in progress around the nightly run. */
const RECENT_DAYS = 1;
const DAY = 86_400_000;
const daysBefore = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10)) - n * DAY).toISOString().slice(0, 10);

export function App() {
  const data = useData();
  const { hash, setHash, pushHash } = useScenario();
  const { meta, validation } = data;

  if (data.status === 'loading') return <Shell><p className="state">{S.loading}</p></Shell>;
  if (data.status === 'error' || !meta || !validation) {
    return (
      <Shell>
        <div className="state state-error" role="alert">
          <p>{S.loadError}</p>
          <button type="button" className="btn" onClick={() => store.retry()}>{S.retry}</button>
        </div>
      </Shell>
    );
  }
  return <Calculator meta={meta} validation={validation} hash={hash} setHash={setHash} pushHash={pushHash} />;
}

function Shell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className="app">
      <header className="top">
        <h1>{S.appTitle}</h1>
        <p className="subtitle">{S.appSubtitle}</p>
        {header}
      </header>
      <main>{children}</main>
    </div>
  );
}

function Calculator({ meta, validation, hash, setHash, pushHash }: {
  meta: MetaFile; validation: ValidationFile; hash: ScenarioHash; setHash: (h: ScenarioHash) => void;
  pushHash: (h: ScenarioHash) => void;
}) {
  const data = useData();
  const { age, gender, weight } = hash;
  const extraSize = data.extra.size;

  const comps = useMemo(() => {
    const m = new Map<number, Comp>(meta.competitions.map((c) => [c.id, c]));
    for (const [id, c] of data.extra) if (!m.has(id)) m.set(id, c);
    return m;
    // data.extra grows in place; its size is the change signal
  }, [meta, extraSize]);

  // A known competition in the hash that gives no points in this age group (hand-edited link): drop it.
  useEffect(() => {
    const keep = hash.added.filter((id) => { const c = comps.get(id); return !c || appliesTo(c, age); });
    if (keep.length !== hash.added.length) setHash({ ...hash, added: keep });
  }, [hash, comps, age, setHash]);

  // Ids the nightly data does not know: look them up; recent competitions: refresh live (non-blocking).
  const generatedDay = meta.generatedAt.slice(0, 10);
  useEffect(() => {
    for (const id of hash.added) {
      const c = comps.get(id);
      if (!c) { void store.resolveId(id); continue; }
      if (store.live.has(id)) continue;
      if (!c.hasResults || c.dateTo >= daysBefore(generatedDay, RECENT_DAYS)) void store.loadLive(c);
    }
  }, [hash.added, comps, generatedDay]);

  const scenario = useMemo(() => resolveScenario(hash, comps, meta.officialDates), [hash, comps, meta.officialDates]);

  // Files for the view: the senior ranking also draws on junior world championships (results-jun).
  const officialOwn = data.official(age);
  const resultsOwn = data.results(age);
  const officialJun = age === 'sen' ? data.official('jun') : undefined;
  const resultsJun = age === 'sen' ? data.results('jun') : undefined;
  const ageStatus = age === 'sen' && data.ageStatus('jun') === 'error' ? 'error' : data.ageStatus(age);
  const ready = !!officialOwn && !!resultsOwn && (age !== 'sen' || (!!officialJun && !!resultsJun));

  const official = useMemo(() => (officialOwn ? [...officialOwn, ...(officialJun ?? [])] : []), [officialOwn, officialJun]);
  const results = useMemo(() => ({ ...(resultsJun ?? {}), ...(resultsOwn ?? {}) }), [resultsOwn, resultsJun]);
  const live = useMemo(() => {
    const out: Record<string, AthleteResult[]> = {};
    for (const [id, s] of store.live) if (s.status === 'ready') out[id] = s.results;
    return out;
  }, [data.liveVersion]);

  const projectionData = useMemo<ProjectionData | null>(
    () => (ready ? { officialDates: meta.officialDates, comps, official, results, live } : null),
    [ready, meta.officialDates, comps, official, results, live],
  );

  const nightlyOf = (c: Comp) => data.results(c.age)?.[c.id];
  const v = validation[age];

  return (
    <Shell header={<StatusLine meta={meta} validation={validation} age={age} />}>
      <ViewPicker hash={hash} comps={comps} setHash={setHash} />
      <AddCompetition meta={meta} comps={comps} hash={hash} setHash={setHash} />
      <CompetitionList
        meta={meta} comps={comps} hash={hash} setHash={setHash} live={data.live} nightlyOf={nightlyOf}
      />
      <TargetDate meta={meta} hash={hash} scenario={scenario} setHash={setHash} />
      <section className="card" aria-labelledby="table-title">
        <h2 id="table-title">
          {S.tableTitle} · {AGE_LABEL[age]} · {GENDER_LABEL[gender]} · <bdi dir="ltr">{weight}</bdi> {S.kg}
        </h2>
        {ageStatus === 'error' ? (
          <div className="state state-error" role="alert">
            <p>{S.loadError}</p>
            <button type="button" className="btn" onClick={() => store.retry()}>{S.retry}</button>
          </div>
        ) : !projectionData ? (
          <p className="state">{S.ageLoading}</p>
        ) : (
          <ProjectionView data={projectionData} scenario={scenario} persons={data.persons} hash={hash} setHash={setHash} pushHash={pushHash} />
        )}
      </section>
      {v && v.checked > 0 && <p className="footnote">{S.validation(pct(v.matched, v.checked))} · {S.gaps(v.checked - v.matched)}</p>}
    </Shell>
  );
}

const pct = (matched: number, checked: number) => (Math.floor((matched / checked) * 1000) / 10).toFixed(1);

function StatusLine({ meta, validation, age }: { meta: MetaFile; validation: ValidationFile; age: AgeGroup }) {
  const v = validation[age];
  const updated = new Date(meta.generatedAt);
  const when = Number.isNaN(updated.getTime())
    ? meta.generatedAt
    : updated.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  const warnings = validation.warnings ?? [];
  return (
    <div className="status">
      <span className="chip">{S.updated(when)}</span>
      {v && v.checked > 0 && (
        <span className="chip chip-accent" title={S.gaps(v.checked - v.matched)}>{S.validation(pct(v.matched, v.checked))}</span>
      )}
      {warnings.length > 0 && (
        <details className="warnings">
          <summary>{S.warnings} ({warnings.length})</summary>
          <ul>{warnings.map((w, i) => <li key={i} dir="ltr">{w}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function ViewPicker({ hash, comps, setHash }: {
  hash: ScenarioHash; comps: Map<number, Comp>; setHash: (h: ScenarioHash) => void;
}) {
  return (
    <section className="card picker">
      <Segmented
        legend={S.ageLegend} name="age" value={hash.age} options={AGES.map((a) => [a, AGE_LABEL[a]])}
        onChange={(a) => setHash(withView(hash, { age: a as AgeGroup }, comps))}
      />
      <Segmented
        legend={S.genderLegend} name="gender" value={hash.gender} options={GENDERS.map((g) => [g, GENDER_LABEL[g]])}
        onChange={(g) => setHash(withView(hash, { gender: g as 'm' | 'f' }, comps))}
      />
      <fieldset className="weights">
        <legend>{S.weightLegend}</legend>
        <div className="weight-grid">
          {WEIGHTS[hash.age][hash.gender].map((w) => (
            <label key={w} className={`weight${w === hash.weight ? ' is-on' : ''}`}>
              <input
                type="radio" name="weight" value={w} checked={w === hash.weight}
                onChange={() => setHash({ ...hash, weight: w, athlete: undefined })}
              />
              <bdi dir="ltr">{w}</bdi>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

function Segmented({ legend, name, value, options, onChange }: {
  legend: string; name: string; value: string; options: [string, string][]; onChange: (v: string) => void;
}) {
  return (
    <fieldset className="segmented">
      <legend>{legend}</legend>
      <div className="seg-row">
        {options.map(([v, label]) => (
          <label key={v} className={`seg${v === value ? ' is-on' : ''}`}>
            <input type="radio" name={name} value={v} checked={v === value} onChange={() => onChange(v)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AddCompetition({ meta, comps, hash, setHash }: {
  meta: MetaFile; comps: Map<number, Comp>; hash: ScenarioHash; setHash: (h: ScenarioHash) => void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const hashRef = useRef(hash);
  const compsRef = useRef(comps);
  useEffect(() => {
    hashRef.current = hash;
    compsRef.current = comps;
  }, [hash, comps]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseJudoTvUrl(input);
    if ('error' in parsed) {
      setNotice({ kind: 'error', text: parsed.error === 'not_judotv' ? S.notJudoTv : S.noCode });
      return;
    }
    setBusy(true);
    setNotice(null);
    const r = await resolveCompetition(parsed.code, [...comps.values()]);
    setBusy(false);
    if ('error' in r) {
      setNotice({ kind: 'error', text: r.error === 'not_found' ? S.notFound : r.error === 'no_points' ? S.noPoints : S.network });
      return;
    }
    const c = r.meta;
    // The lookup can take seconds: apply the competition to the latest hash and competitions, not the ones
    // captured when the form was submitted, so view/toggle/date changes made meanwhile are kept.
    const latestComps = compsRef.current;
    if (!latestComps.has(c.id)) store.addExtra(c);
    const add = addCompetitionToHash(hashRef.current, c, latestComps, meta.officialDates);
    if (add.outcome === 'already_official') {
      setNotice({ kind: 'info', text: S.alreadyOfficial(c.name) });
      return;
    }
    const messages: string[] = [];
    if (add.switched) messages.push(S.switchedAge(c.name, c.age));
    if (add.outcome === 'already_added') messages.push(S.alreadyAdded(c.name));
    else if (!add.switched) messages.push(S.addedOk(c.name));
    if (add.next) setHash(add.next);
    setInput('');
    setNotice({ kind: 'info', text: messages.join(' · ') });
    // Always fetch fresh (results may be partial); the nightly data is used meanwhile and if this fails.
    const known = latestComps.get(c.id);
    const s = await store.loadLive(known ?? c);
    if (s.status === 'failed') {
      setNotice(known?.hasResults
        ? { kind: 'warn', text: S.liveFallback }
        : { kind: 'error', text: `${c.name}: ${S.liveFailedNoData}` });
    }
  }

  return (
    <section className="card" aria-labelledby="add-title">
      <h2 id="add-title">{S.addTitle}</h2>
      <form className="add-form" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="judotv">{S.linkLabel}</label>
        <input
          id="judotv" type="text" inputMode="url" dir="ltr" autoComplete="off" spellCheck={false}
          placeholder={S.linkPlaceholder} value={input} onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
          {busy ? S.adding : S.add}
        </button>
      </form>
      {notice && <p className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    </section>
  );
}

function CompetitionList({ meta, comps, hash, setHash, live, nightlyOf }: {
  meta: MetaFile; comps: Map<number, Comp>; hash: ScenarioHash; setHash: (h: ScenarioHash) => void;
  live: ReadonlyMap<number, LiveState>; nightlyOf: (c: Comp) => AthleteResult[] | undefined;
}) {
  const pending = pendingCompetitions(meta, hash.age);
  const rows: Comp[] = [...pending];
  for (const id of hash.added) {
    const c = comps.get(id);
    if (c && appliesTo(c, hash.age) && !rows.some((r) => r.id === id)) rows.push(c);
  }
  rows.sort((a, b) => (a.dateTo < b.dateTo ? 1 : a.dateTo > b.dateTo ? -1 : b.id - a.id));
  const unresolved = hash.added.filter((id) => !comps.has(id));
  const toggle = (id: number, on: boolean) =>
    setHash({ ...hash, added: on ? [...hash.added.filter((x) => x !== id), id] : hash.added.filter((x) => x !== id) });

  return (
    <section className="card" aria-labelledby="pending-title">
      <h2 id="pending-title">{S.pendingTitle}</h2>
      {rows.length === 0 && unresolved.length === 0 && <p className="muted">{S.pendingEmpty}</p>}
      <ul className="comp-list">
        {rows.map((c) => (
          <CompetitionRow
            key={c.id} c={c} on={hash.added.includes(c.id)} onToggle={(on) => toggle(c.id, on)}
            live={live.get(c.id)} nightly={nightlyOf(c)} viewAge={hash.age}
          />
        ))}
        {unresolved.map((id) => {
          const s = live.get(id)?.status;
          const text = s === 'unknown' ? S.unknownCompetition(id) : s === 'failed' ? `${id}: ${S.liveFailedNoData}` : S.resolving;
          return (
            <li key={id} className="comp comp-unresolved">
              <span className={s === 'unknown' || s === 'failed' ? 'notice-error' : 'muted'}>{text}</span>
              <button type="button" className="btn btn-small" onClick={() => toggle(id, false)}>{S.remove}</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CompetitionRow({ c, on, onToggle, live, nightly, viewAge }: {
  c: Comp; on: boolean; onToggle: (on: boolean) => void; live: LiveState | undefined;
  nightly: AthleteResult[] | undefined; viewAge: AgeGroup;
}) {
  const results = live?.status === 'ready' ? live.results : nightly;
  const progress = results ? competitionProgress(results) : null;
  const partial = progress && progress.total > 0 && progress.finished < progress.total;
  const dates = c.dateFrom === c.dateTo ? formatDate(c.dateTo) : `${formatDate(c.dateFrom)}–${formatDate(c.dateTo)}`;
  let liveNote: Notice | null = null;
  if (live?.status === 'loading') liveNote = { kind: 'info', text: S.liveLoading };
  else if (live?.status === 'failed') liveNote = c.hasResults ? { kind: 'warn', text: S.liveFallback } : { kind: 'error', text: S.liveFailedNoData };

  return (
    <li className={`comp${on ? ' is-on' : ''}`}>
      <label className="comp-toggle">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span className="comp-body">
          <span className="comp-name">{c.name}</span>
          <span className="comp-meta">
            <bdi dir="ltr">{dates}</bdi>
            {viewAge === 'sen' && c.age === 'jun' && <span className="tag">{S.juniorWorlds}</span>}
            {partial && (
              <span className="tag tag-warn">{S.inProgress} · {S.categoriesDone(progress.finished, progress.total)}</span>
            )}
            {(progress ? progress.total === 0 : !c.hasResults && live?.status !== 'loading') && (
              <span className="tag">{S.noResultsYet}</span>
            )}
            {live?.status === 'ready' && <span className="tag tag-ok">{S.liveFresh}</span>}
          </span>
          {liveNote && <span className={`comp-note notice-${liveNote.kind}`}>{liveNote.text}</span>}
        </span>
      </label>
    </li>
  );
}

function TargetDate({ meta, hash, scenario, setHash }: {
  meta: MetaFile; hash: ScenarioHash; scenario: Scenario & { dateIsAuto: boolean }; setHash: (h: ScenarioHash) => void;
}) {
  const officialDate = officialDateOf(meta.officialDates, hash.age);
  return (
    <section className="card" aria-labelledby="date-title">
      <h2 id="date-title"><label htmlFor="target-date">{S.dateTitle}</label></h2>
      <div className="date-row">
        <input
          id="target-date" type="date" value={scenario.targetDate} min={officialDate}
          onChange={(e) => setHash({ ...hash, date: /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : null })}
        />
        {!scenario.dateIsAuto && (
          <button type="button" className="btn btn-small" onClick={() => setHash({ ...hash, date: null })}>{S.dateReset}</button>
        )}
      </div>
      <p className="muted small">{scenario.dateIsAuto ? S.dateAuto : ''}{scenario.dateIsAuto ? ' · ' : ''}{S.dateOfficial(officialDate)}</p>
    </section>
  );
}

/**
 * The projected category (table) or one athlete's breakdown, by the hash. The projection is computed from a
 * deferred copy of the inputs so checkboxes and the date input stay responsive.
 */
function ProjectionView({ data, scenario, persons, hash, setHash, pushHash }: {
  data: ProjectionData; scenario: Scenario; persons: Map<number, Person> | undefined;
  hash: ScenarioHash; setHash: (h: ScenarioHash) => void; pushHash: (h: ScenarioHash) => void;
}) {
  const key = `${scenario.age}|${scenario.added.join(',')}|${scenario.targetDate}`;
  const input = useMemo(() => ({ data, scenario: { ...scenario, gender: 'm' as const, weight: '' }, key }),
    // the projection covers both genders and every weight: gender/weight changes reuse it
    [data, key]);
  const deferred = useDeferredValue(input);
  const projection = useMemo(() => buildProjection(deferred.data, deferred.scenario), [deferred]);
  const stale = deferred !== input;
  const cat = `${scenario.age}-${scenario.gender}${scenario.weight}` as CategoryKey;
  const entries: ProjectedEntry[] = projection.get(cat) ?? [];
  const added = useMemo(() => new Set(scenario.added), [scenario.added]);

  // Opening an athlete scrolls to the card; going back restores where the table was.
  const savedScroll = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);
  const open = hash.athlete;
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open !== undefined && !wasOpen.current) wrap.current?.closest('.card')?.scrollIntoView();
    else if (open === undefined && wasOpen.current) window.scrollTo(0, savedScroll.current);
    wasOpen.current = open !== undefined;
  }, [open]);

  const hashRef = useRef(hash);
  hashRef.current = hash;
  const openAthlete = useCallback((id: number) => {
    savedScroll.current = window.scrollY;
    pushHash({ ...hashRef.current, athlete: id });
  }, [pushHash]);

  if (!entries.length) return <p className="muted">{stale ? S.computing : S.noEntries}</p>;
  return (
    <div ref={wrap} className={stale ? 'is-stale' : undefined} aria-busy={stale}>
      {open !== undefined ? (
        <AthleteBreakdown
          entry={entries.find((e) => e.idPerson === open)} idPerson={open} person={persons?.get(open)}
          age={scenario.age} gender={scenario.gender} weight={scenario.weight} added={added}
          // back to the table via the history entry we pushed; a link opened directly just drops the athlete
          onBack={() => (history.state?.pushed ? history.back() : setHash({ ...hash, athlete: undefined }))}
        />
      ) : (
        <>
          <p className="muted small table-hint">{S.tableHint}{added.size > 0 && ` · ${S.highlightHint}`}</p>
          <CategoryTable
            entries={entries} persons={persons} added={added} onOpen={openAthlete}
            hrefOf={(id) => formatHash({ ...hash, athlete: id })}
          />
        </>
      )}
    </div>
  );
}
