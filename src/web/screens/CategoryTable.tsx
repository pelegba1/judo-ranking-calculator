import { memo, type MouseEvent } from 'react';
import type { Person } from '../../engine/types';
import type { ProjectedEntry } from '../../engine/projection';
import { formatDelta, formatMovement, formatPoints, isAffected } from '../format';
import { S } from '../strings';
import { StarButton } from './StarButton';

interface Props {
  entries: ProjectedEntry[];
  persons: Map<number, Person> | undefined;
  /** Ids of the competitions added to the scenario (rows touched by them are highlighted). */
  added: ReadonlySet<number>;
  hrefOf: (idPerson: number) => string;
  /** Must be referentially stable (Row is memoised). */
  onOpen: (idPerson: number) => void;
  /** Athletes on the watch list (their rows show a filled star). */
  watched: ReadonlySet<number>;
  /** Must be referentially stable (Row is memoised). */
  onToggleStar: (idPerson: number) => void;
}

/**
 * The projected category: one row per athlete = [star button][link]. The link is an <a> (open-in-new-tab and
 * keyboard work); the star is a sibling of it, so no interactive element is nested in another.
 */
export function CategoryTable({ entries, persons, added, hrefOf, onOpen, watched, onToggleStar }: Props) {
  return (
    <div className="ctable">
      <div className="rrow chead">
        <span className="star-spacer" aria-hidden="true" />
        <div className="crow">
          <span>{S.colPlace}</span>
          <span>{S.colMove}</span>
          <span>{S.colName}</span>
          <span className="c-country">{S.colCountry}</span>
          <span className="c-points">{S.colPoints}</span>
        </div>
      </div>
      {entries.map((e) => (
        <Row
          key={e.idPerson} e={e} person={persons?.get(e.idPerson)} hit={isAffected(e, added)} href={hrefOf(e.idPerson)}
          onOpen={onOpen} starred={watched.has(e.idPerson)} onToggleStar={onToggleStar}
        />
      ))}
    </div>
  );
}

const Row = memo(function Row({ e, person, hit, href, onOpen, starred, onToggleStar }: {
  e: ProjectedEntry; person: Person | undefined; hit: boolean; href: string; onOpen: (id: number) => void;
  starred: boolean; onToggleStar: (id: number) => void;
}) {
  const move = formatMovement(e.officialPlace, e.projectedPlace);
  const name = person?.name ?? S.athleteUnknown(e.idPerson);
  const click = (ev: MouseEvent) => {
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    onOpen(e.idPerson);
  };
  return (
    <div className={`rrow${hit ? ' is-hit' : ''}`}>
      <StarButton on={starred} onToggle={() => onToggleStar(e.idPerson)} />
      <a className="crow" href={href} onClick={click}>
        <span className="c-place"><bdi dir="ltr">{e.projectedPlace}</bdi></span>
        <span className={`c-move move-${move.dir}`} title={S.officialWas(e.officialPlace)}><bdi dir="ltr">{move.label}</bdi></span>
        <span className="c-name">
          <span className="c-name-text">{name}</span>
          {!e.verified && <span className="tag tag-warn">{S.notVerified}</span>}
        </span>
        <span className="c-country"><bdi dir="ltr">{person?.country ?? ''}</bdi></span>
        <span className="c-points">
          <bdi dir="ltr">{formatPoints(e.projectedPoints)}</bdi>
          {e.delta !== 0 && <bdi dir="ltr" className={`delta ${e.delta > 0 ? 'up' : 'down'}`}>{formatDelta(e.delta)}</bdi>}
        </span>
      </a>
    </div>
  );
});
