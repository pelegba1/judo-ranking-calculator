import { describe, it, expect } from 'vitest';
import { competed, isWalkover, placeWhenNotPublished, scoredPublishedPlace } from '../../src/engine/rules/participation';
import type { RawContest } from '../../src/data/ijf-api';

const bout = (winner: string, extra: Partial<RawContest> = {}): RawContest => ({
  id_fight: '1', id_person_white: '1', id_person_blue: '2', id_winner: winner, is_finished: '1', bye: '0',
  round_name: 'Round of 32', id_weight: '1', weight: '-60', age: 'Seniors', duration: '00:03:00',
  first_hajime_at_ts: '1760000000', ippon_w: '1', waza_w: '0', yuko_w: '0', penalty_w: '1', ippon_b: '0', waza_b: '0',
  yuko_b: '0', penalty_b: '0', ...extra,
});
const walkover = (winner: string) => bout(winner, {
  duration: '00:00:00', first_hajime_at_ts: '0', penalty_w: '0', ippon_w: winner === '1' ? '1' : '0', ippon_b: winner === '2' ? '1' : '0',
});

describe('isWalkover', () => {
  it('needs 00:00:00, no hajime timestamp and only the winner\'s single ippon', () => {
    expect(isWalkover(walkover('1'))).toBe(true);
    expect(isWalkover(walkover('2'))).toBe(true);
    expect(isWalkover({ ...walkover('1'), first_hajime_at_ts: '1737191320' })).toBe(false); // timed bout, duration unrecorded
    expect(isWalkover({ ...walkover('1'), penalty_b: '1' })).toBe(false);
    expect(isWalkover({ ...walkover('1'), ippon_w: null })).toBe(false); // scores missing
    expect(isWalkover(bout('1'))).toBe(false);
  });
});

describe('competed', () => {
  it('no bout, or only walkover losses: did not compete; a walkover win or a real bout: competed', () => {
    expect(competed([], '2')).toBe(false);
    expect(competed([walkover('1')], '2')).toBe(false);
    expect(competed([walkover('1')], '1')).toBe(true);
    expect(competed([walkover('1'), bout('2')], '2')).toBe(true);
    expect(competed([bout('1')], '2')).toBe(true);
  });
});

describe('scoredPublishedPlace', () => {
  it('pool formats: 4th scores as 5th, 6th as 7th; others unchanged', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(scoredPublishedPlace)).toEqual([1, 2, 3, 5, 5, 7, 7]);
    expect(scoredPublishedPlace(undefined)).toBeUndefined();
  });
});

describe('placeWhenNotPublished', () => {
  it('an unlisted athlete is never 1-7 when places are published: main-bracket loss place, 9 at best', () => {
    expect(placeWhenNotPublished(7, true, [])).toBe(9);
    expect(placeWhenNotPublished(7, true, [9])).toBe(9);
    expect(placeWhenNotPublished(5, true, [17])).toBe(17);
    expect(placeWhenNotPublished(7, false, [])).toBe(7); // nothing published: keep the bout-derived place
    expect(placeWhenNotPublished(17, true, [17])).toBe(17);
    expect(placeWhenNotPublished(null, true, [])).toBeNull();
  });
});
