// IJF public API client. Works in Node 24 and browsers (global fetch only).

export const IJF_API_BASE = 'https://data.ijf.org/api/get_json';
const TIMEOUT_MS = 30_000;

export class IjfApiError extends Error {
  constructor(
    message: string,
    public readonly action?: string,
  ) {
    super(message);
    this.name = 'IjfApiError';
  }
}

export interface RawCompetition {
  id_competition: string;
  date_from: string; // '2026/11/13'
  date_to: string;
  name: string;
  competition_code: string;
  rank_name?: string;
  ages?: string;
  has_results?: string;
  country_short?: string;
  [k: string]: unknown;
}

export interface RawCompetitionInfo {
  id_competition: string;
  date_from: string; // '2026-10-29'
  date_to: string;
  name: string;
  competition_code: string;
  external_id: string;
  country_short?: string;
  updated_at_ts?: string | number;
  [k: string]: unknown;
}

export interface RawContest {
  id_competition?: string;
  id_fight: string;
  id_person_white: string | null;
  id_person_blue: string | null;
  id_winner: string | null;
  is_finished: string;
  bye?: string;
  round_name: string;
  id_weight: string;
  weight: string;
  age: string;
  country_short_white?: string;
  country_short_blue?: string;
  family_name_white?: string;
  family_name_blue?: string;
  given_name_white?: string;
  given_name_blue?: string;
  rank_name?: string;
  [k: string]: unknown;
}

export interface RawCompetitorPerson {
  id_person: string;
  given_name: string;
  family_name: string;
  country_short: string;
  id_weight: string;
  gender: string;
  [k: string]: unknown;
}

export interface RawCompetitorsResponse {
  categories: Record<
    string,
    Record<
      string,
      { category: string; gender: 'male' | 'female'; persons: Record<string, RawCompetitorPerson> }
    >
  >;
}

export interface RawResultPerson {
  id_person: string;
  place: string | number;
  country_short: string;
  continent?: string;
  id_weight: string;
  [k: string]: unknown;
}

export interface RawResultsResponse {
  by_categories: Record<
    string,
    Record<string, { category: string; gender: string; persons: RawResultPerson[] }>
  >;
}

export interface RawRankingRow {
  id_person: string | number;
  id_age: string | number;
  id_weight: string | number;
  place: string | number;
  sum_points: string | number;
  [k: string]: unknown;
}

export interface RawWrlCurrent {
  points: string | number;
  place: string | number;
  id_weight: string | number;
  age: string;
  weight: string;
  ogq_place?: string | number | null;
  ogq_sum_points?: string | number | null;
  q_status?: string | null;
  [k: string]: unknown;
}

export interface RawWrlHistory {
  version: string;
  sum_points: string | number;
  place: string | number;
  age: string;
  weight: string;
  [k: string]: unknown;
}

export async function apiGet<T>(
  action: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const qs = new URLSearchParams();
  qs.set('params[action]', action);
  for (const [k, v] of Object.entries(params)) qs.set(`params[${k}]`, String(v));
  const url = `${IJF_API_BASE}?${qs.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new IjfApiError(`HTTP ${res.status} for ${action}`, action);
    const body = (await res.json()) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body) && 'error' in body) {
      throw new IjfApiError(String((body as { error: unknown }).error), action);
    }
    return body as T;
  } catch (e) {
    if (e instanceof IjfApiError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new IjfApiError(`Timeout after ${TIMEOUT_MS} ms for ${action}`, action);
    }
    throw new IjfApiError(`${action}: ${e instanceof Error ? e.message : String(e)}`, action);
  } finally {
    clearTimeout(timer);
  }
}

export function getCompetitionList(year: number): Promise<RawCompetition[]> {
  return apiGet('competition.get_list', { year, limit: 5000, sort: -1 });
}

export async function getCompetitionInfo(id: number): Promise<RawCompetitionInfo | null> {
  try {
    const info = await apiGet<RawCompetitionInfo>('competition.info', { id_competition: id });
    return info && info.id_competition ? info : null;
  } catch (e) {
    // An unused id answers {"error":"info.error.id_competition_not_exists"}
    if (e instanceof IjfApiError && /not_exists/.test(e.message)) return null;
    throw e;
  }
}

export async function getContests(id: number): Promise<RawContest[]> {
  const r = await apiGet<{ contests: RawContest[] } | RawContest[]>('contest.find', {
    id_competition: id,
    limit: 5000,
  });
  return Array.isArray(r) ? r : (r.contests ?? []);
}

export function getCompetitors(id: number): Promise<RawCompetitorsResponse> {
  return apiGet('competition.competitors', { id_competition: id });
}

export function getResults(id: number): Promise<RawResultsResponse> {
  return apiGet('competition.results', { id_competition: id });
}

export async function getOfficialRanking(): Promise<RawRankingRow[]> {
  const r = await apiGet<{ feed: RawRankingRow[] }>('ranking.get_list', { limit: 20000 });
  return r.feed;
}

export function getWrlCurrent(idPerson: number): Promise<RawWrlCurrent[]> {
  return apiGet('competitor.wrl_current', { id_person: idPerson });
}

export function getWrlHistory(idPerson: number): Promise<RawWrlHistory[]> {
  return apiGet('competitor.wrl_history', { id_person: idPerson });
}
