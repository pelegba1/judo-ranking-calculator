import type { AgeGroup, EventType } from '../types';

export interface Classification { age: AgeGroup; eventType: EventType; }

const AGE: Record<string, AgeGroup> = { sen: 'sen', jun: 'jun', cad: 'cad' };

/**
 * Competitions whose code does not tell how they are scored, checked against official breakdown pages.
 * cont_open_2_aus2025 (Gold Coast Oceania Open 2025): Grand Prix values (1st 700, 2nd 490, 3rd 350, 5th 252,
 * participation 6), and the Grand Prix domestic quota fits the official totals better than none.
 */
export const CODE_OVERRIDES: Record<string, Classification> = {
  cont_open_2_aus2025: { age: 'sen', eventType: 'grand_prix' },
};

/** Classify a competition by its IJF code. Returns null when it gives no WRL points. */
export function classifyCompetition(code: string, _name: string): Classification | null {
  const c = code.toLowerCase();
  let m: RegExpMatchArray | null;
  if (CODE_OVERRIDES[c]) return CODE_OVERRIDES[c];

  if (/^oly_?\d{4}$/.test(c)) return { age: 'sen', eventType: 'olympic_games' }; // not oly_teams2024
  if ((m = c.match(/^wc_(sen|jun|cad)\d{4}$/))) return { age: AGE[m[1]], eventType: 'world_ch' };
  if (/^gs_[a-z]{3}\d{4}$/.test(c)) return { age: 'sen', eventType: 'grand_slam' }; // not gs_deaf_/gs_adapted_
  if (/^masters_/.test(c)) return { age: 'sen', eventType: 'masters' };
  if ((m = c.match(/^gp_(jun|cad)_/))) return { age: AGE[m[1]], eventType: 'grand_prix' };
  if (/^gp_[a-z]{3}\d{4}$/.test(c)) return { age: 'sen', eventType: 'grand_prix' };
  if (/^cont_open_/.test(c)) return { age: 'sen', eventType: 'continental_open' };
  if ((m = c.match(/^cont_cup_(jun|cad)_/))) return { age: AGE[m[1]], eventType: 'continental_cup' };
  // Continental championships: eju/aju/jua/oju/pjc (+ pjc_oju) followed by an age group and year.
  if ((m = c.match(/^(?:pjc|(?:pjc_)?(?:eju|aju|jua|oju))_(sen|jun|cad)\d{4}$/))) {
    return { age: AGE[m[1]], eventType: 'continental_ch' };
  }
  return null;
}
