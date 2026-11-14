import { useMemo, useState } from 'react';
import { useData } from '../state/useData';
import type { ScenarioHash } from '../state/useScenario';
import { encodeWatchlist, type Watchlist } from '../state/watchlist';
import { placesOf, useAllProjections } from '../state/useAllProjections';
import { S } from '../strings';
import { AthleteRows } from './AthleteRows';
import type { AthleteResult, CompetitionMeta } from '../../engine/types';
import type { MetaFile } from '../state/useData';

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
  // Per-age projections do not depend on who is watched (un-starring must not recompute them).
  const all = useAllProjections({ enabled: watchlist.ids.length > 0, meta, comps, live, added: hash.added, date: hash.date });
  // cheap second step: pick the watched athletes out of the projections
  const places = useMemo(() => placesOf(all, new Set(watchlist.ids)), [all.projections, all.olympic, watchlist.ids]);

  return (
    <div>
      {hash.ids && hash.ids.length > 0 && <ShareBanner hash={hash} setHash={setHash} watchlist={watchlist} />}
      {watchlist.ids.length === 0 ? (
        <p className="muted">{S.watchEmpty}</p>
      ) : all.status === 'error' ? (
        <div className="state state-error" role="alert"><p>{S.loadError}</p></div>
      ) : all.status !== 'ready' ? (
        <p className="state">{S.ageLoading}</p>
      ) : (
        <div className={all.stale ? 'is-stale' : undefined} aria-busy={all.stale}>
          <ul className="watch-list">
            {watchlist.ids.map((id) => (
              <AthleteRows
                key={id} id={id} person={data.persons?.get(id)} where={places.get(id)} hash={hash}
                starred onToggleStar={watchlist.toggle}
              />
            ))}
          </ul>
          <ShareLink ids={watchlist.ids} />
        </div>
      )}
    </div>
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
