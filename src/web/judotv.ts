// JudoTV links -> IJF competitions.
import { getCompetitionList, type RawCompetition } from '../data/ijf-api';
import { toCompetitionMeta } from '../data/competition-loader';
import type { CompetitionMeta } from '../engine/types';

export type JudoTvParse = { code: string } | { error: 'not_judotv' | 'no_code' };

const CODE = /^[a-z0-9_]+$/;
/** A bare IJF competition code, e.g. gp_cro2026 (letters, then an underscore, ending in a year). */
const BARE_CODE = /^[a-z][a-z0-9]*_[a-z0-9_]*\d{4}$/;

/** The competition code of a JudoTV link: https://www.judotv.com/competitions/<code>/... (scheme optional). */
export function parseJudoTvUrl(input: string): JudoTvParse {
  const s = input.trim();
  if (BARE_CODE.test(s.toLowerCase())) return { code: s.toLowerCase() };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return { error: 'not_judotv' };
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'judotv.com' && !host.endsWith('.judotv.com')) return { error: 'not_judotv' };
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.findIndex((p) => p.toLowerCase() === 'competitions');
  const code = i >= 0 ? (parts[i + 1] ?? '').toLowerCase() : '';
  return code && CODE.test(code) ? { code } : { error: 'no_code' };
}

/** The year in a competition code's trailing four digits, else `fallback`. */
export function yearOfCode(code: string, fallback: number): number {
  const m = code.match(/(\d{4})$/);
  return m ? Number(m[1]) : fallback;
}

export type ResolveResult = { meta: CompetitionMeta } | { error: 'not_found' | 'no_points' | 'network' };

/**
 * The competition of a code: from the known competitions (meta.json), else from competition.get_list of the
 * code's year. A listed competition the classifier rejects gives no ranking points.
 */
export async function resolveCompetition(
  code: string, known: CompetitionMeta[], getList: (year: number) => Promise<RawCompetition[]> = getCompetitionList,
): Promise<ResolveResult> {
  const c = code.toLowerCase();
  const hit = known.find((m) => m.code.toLowerCase() === c);
  if (hit) return { meta: hit };
  let rows: RawCompetition[];
  try {
    rows = await getList(yearOfCode(c, new Date().getUTCFullYear()));
  } catch {
    return { error: 'network' };
  }
  const row = (Array.isArray(rows) ? rows : []).find((r) => String(r.competition_code ?? '').toLowerCase() === c);
  if (!row) return { error: 'not_found' };
  const meta = toCompetitionMeta(row);
  return meta ? { meta } : { error: 'no_points' };
}
