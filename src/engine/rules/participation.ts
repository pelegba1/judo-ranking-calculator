import type { RawContest } from '../../data/ijf-api';
import type { Place } from '../types';

// Who took part in a category and which place they get, where the IJF data and the official ranking disagree with a
// plain reading of the bouts. Each rule was checked against official breakdown pages (Task 7, docs/validation-notes.md).

const truthy = (v: unknown): boolean =>
  v === true || (v != null && v !== '' && v !== '0' && v !== 0 && v !== false);

const SCORE_FIELDS = ['ippon_w', 'waza_w', 'yuko_w', 'penalty_w', 'ippon_b', 'waza_b', 'yuko_b', 'penalty_b'] as const;

/**
 * A walkover (fusen-gachi): recorded as a finished bout of duration 00:00:00, without a hajime timestamp, whose
 * only score is the winner's single ippon. Real bouts with an unrecorded duration still have a hajime timestamp
 * (seen in cont_open_mar2025); bouts with missing scores or penalties are not walkovers.
 */
export function isWalkover(b: RawContest): boolean {
  if (!truthy(b.is_finished) || !b.id_winner || String(b.duration ?? '') !== '00:00:00') return false;
  if (truthy(b.first_hajime_at_ts)) return false;
  const winnerSide = b.id_winner === b.id_person_white ? 'w' : b.id_winner === b.id_person_blue ? 'b' : null;
  if (!winnerSide) return false;
  return SCORE_FIELDS.every((f) => {
    const v = b[f];
    if (v === null || v === undefined || v === '') return f.startsWith('yuko'); // yuko may be absent; others must be set
    return Number(v) === (f === `ippon_${winnerSide}` ? 1 : 0);
  });
}

/**
 * Whether an athlete (id `sid`) not in the published places competed, given their finished bouts in a finished
 * category. No bout, or only walkover losses (= did not show up): no result at all. Official breakdowns list such
 * athletes with 0 points or not at all. A walkover win counts as competing.
 */
export function competed(finished: RawContest[], sid: string): boolean {
  return finished.some((b) => b.id_winner === sid || !isWalkover(b));
}

/** A published place as it scores: pool formats publish 4th and 6th, which score as 5th and 7th. */
export function scoredPublishedPlace(published: number | undefined): number | undefined {
  return published === 4 ? 5 : published === 6 ? 7 : published;
}

/**
 * Places 1-7 come only from the published results. In a finished category with published places, an athlete
 * missing there was not 5th/7th even if the bouts say so (repechage from the last 16: an early repechage loss is
 * "fights won", cont_cup_jun_ita2026): the place is the main-bracket loss place, 9 at best. `mainBracketLosses` are
 * the places of the athlete's losses in 'Round of N' / 'Round k' rounds.
 */
export function placeWhenNotPublished(
  derived: Place | null, categoryHasPublished: boolean, mainBracketLosses: Place[],
): Place | null {
  if (!categoryHasPublished || derived === null || derived > 7) return derived;
  return mainBracketLosses.reduce<Place>((worst, p) => (p > worst ? p : worst), 9);
}
