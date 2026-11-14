import type {
  RawCompetitorsResponse,
  RawContest,
  RawResultsResponse,
} from '../data/ijf-api';
import type { AthleteResult, CompetitionMeta, Gender, Place } from './types';

// Data findings: byes do not appear as bouts. A few competitions flag real bouts (both competitors, a winner) with
// bye === '1' (cont_cup_jun_uzb2026: 14 bouts); the official ranking counts them as contests won, so the flag is
// ignored. Walkovers (fusen-gachi, see isWalkover) count as wins for the winner; the loser did not compete.
// Round names seen: 'Round of 128/64/32/16', 'Round 1/2/3' (relative rounds, 3177),
// 'Quarter-Final', 'Repechage', 'Semi-Final', 'Bronze', 'Final'.

/**
 * Version of the derivation rules below. Bump it whenever a change alters derived results: the nightly pipeline
 * re-derives stored competitions of an older version. 1 = Task 4; 2 = Task 7 rules (no-shows, published places,
 * pool categories, bye flag, winnerless bouts).
 */
export const PLACINGS_VERSION = 2;

const VALID_PLACES: ReadonlySet<number> = new Set([1, 2, 3, 5, 7, 9, 17, 33, 65, 129]);

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

function asPlace(v: unknown): Place | null {
  const n = Number(v);
  return VALID_PLACES.has(n) ? (n as Place) : null;
}

/** Place for losing in "Round of N". */
const placeForRoundOf = (n: number): Place | null => asPlace(n / 2 + 1);

interface Cat {
  idWeight: string;
  weight: string;
  gender?: Gender;
  bouts: RawContest[];
  entrants: Map<number, { country: string; gender?: Gender }>;
  resultPlace: Map<number, number>;
}

function toGender(v: unknown): Gender | undefined {
  const s = String(v ?? '').toLowerCase();
  if (s === '1' || s === 'm' || s === 'male') return 'm';
  if (s === '2' || s === 'f' || s === 'female') return 'f';
  return undefined;
}

function genderFromContest(c: RawContest): Gender | undefined {
  const m = String(c.contest_code_long ?? '').match(/_([mf])_/);
  return m ? (m[1] as Gender) : undefined;
}

export function derivePlacings(
  meta: CompetitionMeta,
  contests: RawContest[],
  competitors: RawCompetitorsResponse,
  results: RawResultsResponse,
): AthleteResult[] {
  const cats = new Map<string, Cat>();
  const cat = (idWeight: string, weight = ''): Cat => {
    let c = cats.get(idWeight);
    if (!c) {
      c = { idWeight, weight, bouts: [], entrants: new Map(), resultPlace: new Map() };
      cats.set(idWeight, c);
    }
    if (!c.weight && weight) c.weight = weight;
    return c;
  };

  for (const b of contests) {
    const c = cat(String(b.id_weight), b.weight);
    c.bouts.push(b);
    c.gender ??= genderFromContest(b);
  }

  for (const ageGroup of Object.values(competitors?.categories ?? {})) {
    for (const [idWeight, group] of Object.entries(ageGroup)) {
      const c = cat(idWeight, group.category);
      for (const p of Object.values(group.persons)) {
        // person-level gender only: the category-level gender field is unreliable
        c.entrants.set(Number(p.id_person), { country: p.country_short, gender: toGender(p.gender) });
      }
    }
  }

  for (const ageGroup of Object.values(results?.by_categories ?? {})) {
    for (const [idWeight, group] of Object.entries(ageGroup)) {
      const c = cat(idWeight, group.category);
      for (const p of group.persons) {
        const id = Number(p.id_person);
        c.resultPlace.set(id, Number(p.place));
        const g = toGender(p.gender) ?? toGender(group.gender);
        const e = c.entrants.get(id);
        if (!e) c.entrants.set(id, { country: p.country_short, gender: g });
        else if (!e.gender) e.gender = g;
      }
    }
  }

  const out: AthleteResult[] = [];
  for (const c of cats.values()) {
    const finalBout = c.bouts.find((b) => b.round_name === 'Final');
    // A pool category (up to 5 fighters, 'Round 1' only) has no Final: it is finished when every bout is and the
    // official places are published.
    const categoryFinished = finalBout
      ? truthy(finalBout.is_finished)
      : c.bouts.length > 0 && c.resultPlace.size > 0 && c.bouts.every((b) => truthy(b.is_finished));

    // 'Round k' rounds are relative: the last one is the Round-of-16 equivalent (place 9)
    let maxRel = 0;
    let maxAbs = 0;
    for (const b of c.bouts) {
      const rel = /^Round (\d+)$/.exec(b.round_name);
      if (rel) maxRel = Math.max(maxRel, Number(rel[1]));
      const abs = /^Round of (\d+)$/.exec(b.round_name);
      if (abs) maxAbs = Math.max(maxAbs, Number(abs[1]));
    }
    const lossPlaceForRound = (name: string): Place | null => {
      const abs = /^Round of (\d+)$/.exec(name);
      if (abs) return placeForRoundOf(Number(abs[1]));
      const rel = /^Round (\d+)$/.exec(name);
      if (rel) return asPlace(8 * 2 ** (maxRel - Number(rel[1])) + 1);
      return null;
    };
    const lowestPlace: Place =
      (maxAbs > 0 ? placeForRoundOf(maxAbs) : maxRel > 0 ? lossPlaceForRound('Round 1') : null) ?? 9;

    const ids = new Set<number>(c.entrants.keys());
    for (const b of c.bouts) {
      if (b.id_person_white) ids.add(Number(b.id_person_white));
      if (b.id_person_blue) ids.add(Number(b.id_person_blue));
    }

    for (const id of ids) {
      const sid = String(id);
      const mine = c.bouts.filter((b) => b.id_person_white === sid || b.id_person_blue === sid);
      const finished = mine.filter((b) => truthy(b.is_finished));
      const won = (b: RawContest) => b.id_winner === sid;
      const wins = finished.filter((b) => won(b) && b.id_person_white && b.id_person_blue).length;
      const lost = (name: string) => finished.some((b) => b.round_name === name && b.id_winner && !won(b));
      const wonIn = (name: string) => finished.some((b) => b.round_name === name && won(b));

      let place: Place | null = null;
      if (wonIn('Final')) place = 1;
      else if (lost('Final')) place = 2;
      else if (wonIn('Bronze')) place = 3;
      else if (lost('Bronze')) place = 5;
      else if (lost('Repechage')) place = 7;
      else if (wonIn('Repechage') || lost('Semi-Final')) place = 5; // bronze bout pending / SF loser
      else if (lost('Quarter-Final')) place = 7;
      else {
        for (const b of finished) {
          if (!won(b)) { // a finished bout without a winner (withdrawal) also ends the run (gp_aut2026: official 1/32)
            const p = lossPlaceForRound(b.round_name);
            if (p && (place === null || p < place)) place = p;
          }
        }
      }

      // official results take precedence for places 1-7 (also covers pool formats, where 4th and 6th occur:
      // they score as 5th and 7th)
      const listed = c.resultPlace.has(id);
      const rawPlace = c.resultPlace.get(id);
      const rp = asPlace(rawPlace === 4 ? 5 : rawPlace === 6 ? 7 : rawPlace);
      if (rp !== null && rp <= 7) place = rp;

      if (categoryFinished && !listed) {
        // Never competed (no bout, or only walkover losses = did not show up): no result at all. Official breakdowns
        // list such athletes with 0 points or not at all.
        if (!finished.some((b) => won(b) || !isWalkover(b))) continue;
        // Places 1-7 are published in the results; an athlete missing there was not placed 5th/7th. This happens
        // with a repechage from the last 16 (an early repechage loss is not 7th): the place is the main-bracket loss.
        if (c.resultPlace.size > 0 && place !== null && place <= 7) {
          place = 9;
          for (const b of finished) {
            const p = b.id_winner && !won(b) ? lossPlaceForRound(b.round_name) : null;
            if (p && p > place) place = p;
          }
        }
      }
      if (place === null) place = rp ?? (mine.length === 0 ? lowestPlace : 9);

      const ent = c.entrants.get(id);
      const gender = ent?.gender ?? c.gender;
      if (!gender) continue; // unknowable; never happens with real data
      const first = mine[0];
      const country =
        ent?.country ??
        (first ? (first.id_person_white === sid ? first.country_short_white : first.country_short_blue) : '') ??
        '';

      out.push({
        competitionId: meta.id,
        idPerson: id,
        gender,
        weight: c.weight,
        place,
        wins,
        country: country ?? '',
        categoryFinished,
      });
    }
  }
  return out;
}
