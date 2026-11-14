import type {
  RawCompetitorsResponse,
  RawContest,
  RawResultsResponse,
} from '../data/ijf-api';
import type { AthleteResult, CompetitionMeta, Gender, Place } from './types';

// Data findings (see fixtures): byes never appear as bouts (every contest has both
// competitors and bye === '0'), so a bye cannot inflate wins. Walkovers (fusen-gachi)
// are indistinguishable finished bouts with an id_winner and count as wins.
// Round names seen: 'Round of 128/64/32/16', 'Round 1/2/3' (relative rounds, 3177),
// 'Quarter-Final', 'Repechage', 'Semi-Final', 'Bronze', 'Final'.

const VALID_PLACES: ReadonlySet<number> = new Set([1, 2, 3, 5, 7, 9, 17, 33, 65, 129]);

const truthy = (v: unknown): boolean =>
  v === true || (v != null && v !== '' && v !== '0' && v !== 0 && v !== false);

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
    const categoryFinished = !!finalBout && truthy(finalBout.is_finished);

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
      const wins = finished.filter((b) => won(b) && !truthy(b.bye)).length;
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
          if (b.id_winner && !won(b)) {
            const p = lossPlaceForRound(b.round_name);
            if (p && (place === null || p < place)) place = p;
          }
        }
      }

      // official results take precedence for places 1-7 (also covers pool formats)
      const rp = asPlace(c.resultPlace.get(id));
      if (rp !== null && rp <= 7) place = rp;
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
