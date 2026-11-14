import { useMemo, useState } from 'react';
import { useData } from '../state/useData';
import { AGES, buildProjection, formatHash, resolveScenario, type ProjectionData, type ScenarioHash } from '../state/useScenario';
import { encodeWatchlist, type Watchlist } from '../state/watchlist';
import { formatMovement, formatPoints } from '../format';
import { AGE_LABEL, GENDER_LABEL, S } from '../strings';
import { StarButton } from './StarButton';
import type { AgeGroup, AthleteResult, CategoryKey, CompetitionMeta, Gender } from '../../engine/types';
import type { OfficialEntry, ProjectedEntry } from '../../engine/projection';
import type { MetaFile } from '../state/useData';

interface Where { age: AgeGroup; gender: Gender; weight: string; entry: ProjectedEntry }

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
  const places = useMemo(() => {
    const out = new Map<number, Where[]>();
    if (!loadedAll || watchlist.ids.length === 0) return out;
    const official: Record<AgeGroup, OfficialEntry[]> = { sen: o0!, jun: o1!, cad: o2! };
    const results: Record<AgeGroup, Record<string, AthleteResult[]>> = { sen: r0!, jun: r1!, cad: r2! };
    const wanted = new Set(watchlist.ids);
    for (const age of AGES) {
      const pd: ProjectionData = {
        officialDates: meta.officialDates, comps, live,
        // seniors also draw on junior world championships
        official: age === 'sen' ? [...official.sen, ...official.jun] : official[age],
        results: age === 'sen' ? { ...results.jun, ...results.sen } : results[age],
      };
      const scenario = resolveScenario({ ...hash, age }, comps, meta.officialDates);
      for (const [cat, entries] of buildProjection(pd, scenario)) {
        for (const entry of entries) {
          if (!wanted.has(entry.idPerson)) continue;
          const key = cat as CategoryKey;
          const gender = key[4] as Gender;
          const list = out.get(entry.idPerson) ?? [];
          list.push({ age, gender, weight: key.slice(5), entry });
          out.set(entry.idPerson, list);
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hash.added/date are the scenario inputs
  }, [loadedAll, o0, o1, o2, r0, r1, r2, meta, comps, live, hash.added, hash.date, watchlist.ids]);

  return (
    <div>
      {hash.ids && hash.ids.length > 0 && <ShareBanner hash={hash} setHash={setHash} watchlist={watchlist} />}
      {watchlist.ids.length === 0 ? (
        <p className="muted">{S.watchEmpty}</p>
      ) : failed ? (
        <div className="state state-error" role="alert"><p>{S.loadError}</p></div>
      ) : !loadedAll ? (
        <p className="state">{S.ageLoading}</p>
      ) : (
        <>
          <ul className="watch-list">
            {watchlist.ids.map((id) => (
              <WatchRow key={id} id={id} where={places.get(id)} hash={hash} watchlist={watchlist} />
            ))}
          </ul>
          <ShareLink ids={watchlist.ids} />
        </>
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
              </span>
              {/* Task 12: Olympic place/status goes here */}
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
