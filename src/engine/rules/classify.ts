import type { AgeGroup, EventType } from '../types';

export interface Classification { age: AgeGroup; eventType: EventType; }

const AGE: Record<string, AgeGroup> = { sen: 'sen', jun: 'jun', cad: 'cad' };

/** Classify a competition by its IJF code. Returns null when it gives no WRL points. */
export function classifyCompetition(code: string, _name: string): Classification | null {
  const c = code.toLowerCase();
  let m: RegExpMatchArray | null;

  if (/^oly/.test(c)) return { age: 'sen', eventType: 'olympic_games' };
  if ((m = c.match(/^wc_(sen|jun|cad)\d{4}$/))) return { age: AGE[m[1]], eventType: 'world_ch' };
  if (/^gs_/.test(c)) return { age: 'sen', eventType: 'grand_slam' };
  if (/^masters_/.test(c)) return { age: 'sen', eventType: 'masters' };
  if ((m = c.match(/^gp_(jun|cad)_/))) return { age: AGE[m[1]], eventType: 'grand_prix' };
  if (/^gp_[a-z]{3}\d{4}$/.test(c)) return { age: 'sen', eventType: 'grand_prix' };
  if (/^cont_open_/.test(c)) return { age: 'sen', eventType: 'continental_open' };
  if ((m = c.match(/^cont_cup_(jun|cad)_/))) return { age: AGE[m[1]], eventType: 'continental_cup' };
  // Continental championships: eju/aju/jua/oju (+ pjc_oju) followed by an age group and year.
  if ((m = c.match(/^(?:pjc_)?(?:eju|aju|jua|oju)_(sen|jun|cad)\d{4}$/))) {
    return { age: AGE[m[1]], eventType: 'continental_ch' };
  }
  return null;
}
