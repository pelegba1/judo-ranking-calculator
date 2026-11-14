import { useDeferredValue, useMemo, useState } from 'react';
import { useData } from '../state/useData';
import { AGES, buildProjection, formatHash, resolveScenario, viewFiles, type ProjectionData, type ScenarioHash } from '../state/useScenario';
import { encodeWatchlist, type Watchlist } from '../state/watchlist';
import { formatMovement, formatPoints } from '../format';
import { AGE_LABEL, GENDER_LABEL, S, STATUS_LABEL } from '../strings';
import { buildOlympicMemo, type OlympicRow, type OlympicView } from '../state/olympic';
import { StarButton } from './StarButton';
import type { AgeGroup, AthleteResult, CategoryKey, CompetitionMeta, Gender } from '../../engine/types';
import type { OfficialEntry, ProjectedEntry } from '../../engine/projection';
import type { MetaFile } from '../state/useData';

interface Where { age: AgeGroup; gender: Gender; weight: string; entry: ProjectedEntry; olympic?: OlympicRow }

interface Props {
  meta: MetaFile;
  comps: Map<number, CompetitionMeta>;
  hash: ScenarioHash;
  setHash: (h: ScenarioHash) => void;
  watchlist: Watchlist;
  live: Record<string, AthleteResult[]>;
}

/** Every watched athlete with the categories they appear in (projected place, movement and points). */
export function WatchList({ meta, comps, hash, setHash, watchlist, live }: Props) {
  const data = useData();
  // all three age groups are needed to find an athlete's categories
  const files = AGES.map((a) => ({ official: data.official(a), results: data.results(a) }));
  const loadedAll = files.every((f) => f.official && f.results);
  const failed = AGES.some((a) => data.ageStatus(a) === 'error');

  const [o0, o1, o2] = files.map((f) => f.official);
  const [r0, r1, r2] = files.map((f) => f.results);
  const hasWatched = watchlist.ids.length > 0;
  // Olympic place/status of senior entries: optional (the list shows without it while it loads or if it fails)
  const olympicFile = data.olympicOfficial();
  const persons = data.persons;
  // Per-age projections do not depend on who is watched (un-starring must not recompute them), and are heavy:
  // their inputs go through useDeferredValue like the table's, and the screen shows a busy state meanwhile.
  const input = useMemo(
    () => ({ loadedAll: loadedAll && hasWatched, o: [o0, o1, o2], r: [r0, r1, r2], meta, comps, live, added: hash.added, date: hash.date, olympicFile, persons }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hash.added/date are the scenario inputs
    [loadedAll, hasWatched, o0, o1, o2, r0, r1, r2, meta, comps, live, hash.added, hash.date, olympicFile, persons],
  );
  const deferred = useDeferredValue(input);
  const stale = deferred !== input;
  const { projections, olympic } = useMemo(() => {
    const out = new Map<AgeGroup, Map<CategoryKey, ProjectedEntry[]>>();
    let olympic: OlympicView | null = null;
    if (!deferred.loadedAll) return { projections: out, olympic };
    const official: Record<AgeGroup, OfficialEntry[]> = { sen: deferred.o[0]!, jun: deferred.o[1]!, cad: deferred.o[2]! };
    const results: Record<AgeGroup, Record<string, AthleteResult[]>> = { sen: deferred.r[0]!, jun: deferred.r[1]!, cad: deferred.r[2]! };
    for (const age of AGES) {
      const pd: ProjectionData = {
        officialDates: deferred.meta.officialDates, comps: deferred.comps, live: deferred.live,
        // seniors also draw on junior world championships
        ...viewFiles(age, { official: official[age], results: results[age] }, { official: official.jun, results: results.jun }),
      };
      const scenario = resolveScenario({ age, gender: 'm', weight: '', added: deferred.added, date: deferred.date }, deferred.comps, deferred.meta.officialDates);
      out.set(age, buildProjection(pd, scenario));
      if (age === 'sen' && deferred.olympicFile && deferred.persons) {
        olympic = buildOlympicMemo(pd, deferred.olympicFile, deferred.persons, scenario); // shared with the Olympic screen
      }
    }
    return { projections: out, olympic };
  }, [deferred]);
  // cheap second step: pick the watched athletes out of the projections
  const places = useMemo(() => {
    const out = new Map<number, Where[]>();
    const wanted = new Set(watchlist.ids);
    for (const [age, proj] of projections) {
      for (const [cat, entries] of proj) {
        for (const entry of entries) {
          if (!wanted.has(entry.idPerson)) continue;
          const gender = cat[4] as Gender;
          const list = out.get(entry.idPerson) ?? [];
          const o = age === 'sen' ? olympic?.byCategory.get(cat)?.find((r) => r.idPerson === entry.idPerson) : undefined;
          list.push({ age, gender, weight: cat.slice(5), entry, olympic: o });
          out.set(entry.idPerson, list);
        }
      }
    }
    return out;
  }, [projections, olympic, watchlist.ids]);

  return (
    <div>
      {hash.ids && hash.ids.length > 0 && <ShareBanner hash={hash} setHash={setHash} watchlist={watchlist} />}
      {watchlist.ids.length === 0 ? (
        <p className="muted">{S.watchEmpty}</p>
      ) : failed ? (
        <div className="state state-error" role="alert"><p>{S.loadError}</p></div>
      ) : !loadedAll ? (
        <p className="state">{S.ageLoading}</p>
      ) : projections.size === 0 ? (
        <p className="state">{S.computing}</p>
      ) : (
        <div className={stale ? 'is-stale' : undefined} aria-busy={stale}>
          <ul className="watch-list">
            {watchlist.ids.map((id) => (
              <WatchRow key={id} id={id} where={places.get(id)} hash={hash} watchlist={watchlist} />
            ))}
          </ul>
          <ShareLink ids={watchlist.ids} />
        </div>
      )}
    </div>
  );
}

function WatchRow({ id, where, hash, watchlist }: { id: number; where: Where[] | undefined; hash: ScenarioHash; watchlist: Watchlist }) {
  const data = useData();
  const person = data.persons?.get(id);
  const name = person?.name ?? S.athleteUnknown(id);
  const who = (
    <span className="watch-who">
      <span className="watch-name">{name}</span>
      {person?.country && <span className="muted small"><bdi dir="ltr">{person.country}</bdi></span>}
    </span>
  );
  if (!where?.length) {
    return (
      <li className="watch-item">
        <StarButton on onToggle={() => watchlist.toggle(id)} />
        <div className="watch-link">{who}<span className="muted small">{S.watchNotFound}</span></div>
      </li>
    );
  }
  return (
    <>
      {where.map((w) => {
        const move = formatMovement(w.entry.officialPlace, w.entry.projectedPlace);
        const { watch: _w, ids: _i, ...rest } = hash;
        const href = formatHash({ ...rest, age: w.age, gender: w.gender, weight: w.weight, athlete: id });
        return (
          <li key={`${w.age}-${w.gender}${w.weight}`} className="watch-item">
            <StarButton on onToggle={() => watchlist.toggle(id)} />
            <a className="watch-link" href={href}>
              <span className="watch-who">
                <span className="watch-name">{name}</span>
                <span className="muted small">
                  {person?.country && <><bdi dir="ltr">{person.country}</bdi> · </>}{AGE_LABEL[w.age]} · {GENDER_LABEL[w.gender]} · <bdi dir="ltr">{w.weight}</bdi> {S.kg}
                </span>
                {w.olympic && (
                  <span className="watch-oly">
                    <span className="muted small">{S.olympicShort}: <bdi dir="ltr">{w.olympic.projectedPlace}</bdi></span>
                    <span className={`ochip ochip-${w.olympic.status.kind}`}>{STATUS_LABEL[w.olympic.status.kind]}</span>
                  </span>
                )}
              </span>
              <span className="watch-fig">
                <span>
                  <bdi dir="ltr">{w.entry.projectedPlace}</bdi>{' '}
                  <span className={`move-${move.dir}`}><bdi dir="ltr">{move.label}</bdi></span>
                </span>
                <span className="small"><bdi dir="ltr">{formatPoints(w.entry.projectedPoints)}</bdi></span>
              </span>
            </a>
          </li>
        );
      })}
    </>
  );
}

function ShareBanner({ hash, setHash, watchlist }: { hash: ScenarioHash; setHash: (h: ScenarioHash) => void; watchlist: Watchlist }) {
  const ids = hash.ids ?? [];
  const done = (add: boolean) => {
    if (add) watchlist.addMany(ids);
    setHash({ ...hash, ids: undefined }); // replaceState: the link is not offered again on reload
  };
  return (
    <div className="share-banner" role="region" aria-label={S.shareBanner}>
      <strong>{S.shareBanner}</strong>
      <p className="small">{S.shareBannerCount(ids.length)}</p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => done(true)}>{S.shareAdd}</button>
        <button type="button" className="btn" onClick={() => done(false)}>{S.shareDismiss}</button>
      </div>
    </div>
  );
}

function ShareLink({ ids }: { ids: number[] }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    const url = `${location.origin}${location.pathname}#/watch?ids=${encodeWatchlist(ids)}`;
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <div className="watch-tools">
      <button type="button" className="btn btn-small" onClick={() => void copy()}>{S.shareList}</button>
      <span className="muted small" role="status">{state === 'copied' ? S.shareCopied : state === 'failed' ? S.shareFailed : ''}</span>
    </div>
  );
}
