import { formatHash, type ScenarioHash } from '../state/useScenario';
import type { Where } from '../state/useAllProjections';
import { formatMovement, formatPoints } from '../format';
import { AGE_LABEL, GENDER_LABEL, S, STATUS_LABEL } from '../strings';
import { StarButton } from './StarButton';
import type { Person } from '../../engine/types';

/**
 * One athlete as list rows (watch list, search): a row per category they appear in, each a link to their
 * breakdown there, with projected place, movement, points and (seniors) the Olympic status.
 */
export function AthleteRows({ id, person, where, hash, starred, onToggleStar }: {
  id: number; person: Person | undefined; where: Where[] | undefined; hash: ScenarioHash;
  starred: boolean; onToggleStar: (id: number) => void;
}) {
  const name = person?.name ?? S.athleteUnknown(id);
  if (!where?.length) {
    return (
      <li className="watch-item">
        <StarButton on={starred} onToggle={() => onToggleStar(id)} />
        <div className="watch-link">
          <span className="watch-who">
            <span className="watch-name">{name}</span>
            {person?.country && <span className="muted small"><bdi dir="ltr">{person.country}</bdi></span>}
          </span>
          <span className="muted small">{S.watchNotFound}</span>
        </div>
      </li>
    );
  }
  const { watch: _w, ids: _i, search: _s, q: _q, olympic: _o, ...rest } = hash;
  return (
    <>
      {where.map((w) => {
        const move = formatMovement(w.entry.officialPlace, w.entry.projectedPlace);
        const href = formatHash({ ...rest, age: w.age, gender: w.gender, weight: w.weight, athlete: id });
        return (
          <li key={`${w.age}-${w.gender}${w.weight}`} className="watch-item">
            <StarButton on={starred} onToggle={() => onToggleStar(id)} />
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
