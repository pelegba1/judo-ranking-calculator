// The official Olympic ranking page, https://ijf.org/world-ranking/olympic (?category=all_female for women).
// Server-rendered Nuxt: the vue-query cache is in the <script id="__NUXT_DATA__"> payload (devalue format). Only the
// first page (24 athletes per gender, all categories, best first) is server-rendered. See
// docs/research/olympic-points.md.
import type { CategoryKey, Gender } from '../engine/types';
import { WEIGHTS } from '../engine/rules/categories';

export const OLYMPIC_PAGE_URL: Record<Gender, string> = {
  m: 'https://ijf.org/world-ranking/olympic',
  f: 'https://ijf.org/world-ranking/olympic?category=all_female',
};

export interface OlympicPageRow {
  idPerson: number;
  category: CategoryKey;
  points: number;
  /** Place in the category's Olympic ranking. */
  place: number;
  /** Olympic qualification status code (see OLYMPIC_STATUS_CODES), null when absent. */
  status: number | null;
}

/** Olympic qualification status codes (`ogq.status.idStatus` on the page, `q_status` in the API). */
export const OLYMPIC_STATUS_CODES: Record<number, string> = {
  0: 'Not qualified', 1: 'Qualified', 2: 'Continental quota', 3: 'Qualified* (not the highest ranked of the NOC)',
  4: 'Host nation', 5: 'Returned quota', 10: 'Ineligible', 11: 'Continental quota (undetermined)', 12: 'Team invitation',
  17: 'Undetermined', 18: 'Returned team invitation',
};

const WRAPPERS = new Set(['ShallowReactive', 'Reactive', 'Ref', 'ShallowRef', 'NuxtError']);

/** Rebuilds the object graph of a devalue payload (array of nodes; numbers in containers are node indexes). */
export function reviveDevalue(nodes: unknown[]): unknown {
  const memo = new Map<number, unknown>();
  const at = (i: number): unknown => {
    if (i < 0) return undefined; // -1 undefined, -2 hole, ...
    if (memo.has(i)) return memo.get(i);
    const v = nodes[i];
    if (v === null || typeof v !== 'object') {
      memo.set(i, v);
      return v;
    }
    if (Array.isArray(v)) {
      const tag = v[0];
      if (typeof tag === 'string' && v.length >= 1 && (WRAPPERS.has(tag) || ['EmptyRef', 'EmptyShallowRef', 'Set', 'Map', 'Date'].includes(tag))) {
        let out: unknown;
        if (WRAPPERS.has(tag)) out = at(v[1] as number);
        else if (tag === 'Set') out = v.slice(1).map((x) => at(x as number));
        else if (tag === 'Map') {
          const m: Record<string, unknown> = {};
          for (let k = 1; k + 1 < v.length; k += 2) m[String(at(v[k] as number))] = at(v[k + 1] as number);
          out = m;
        } else if (tag === 'Date') out = v[1];
        memo.set(i, out);
        return out;
      }
      const arr: unknown[] = [];
      memo.set(i, arr);
      for (const x of v) arr.push(at(x as number));
      return arr;
    }
    const obj: Record<string, unknown> = {};
    memo.set(i, obj);
    for (const [k, x] of Object.entries(v)) obj[k] = at(x as number);
    return obj;
  };
  return at(0);
}

interface RawPageRow {
  judoka?: { idJudoka?: number; gender?: string };
  weightCategory?: { name?: string };
  place?: number;
  totalPoints?: number;
  ogq?: { status?: { idStatus?: number } | null } | null;
}

/**
 * The ranking rows server-rendered in an Olympic ranking page. Throws when the payload is missing or holds no
 * Olympic ranking list (the page changed): the caller decides what to do without it.
 */
export function parseOlympicPage(html: string): OlympicPageRow[] {
  const m = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('olympic page: no __NUXT_DATA__ payload');
  const root = reviveDevalue(JSON.parse(m[1]) as unknown[]) as {
    vueQueryState?: { queries?: { queryKey?: unknown[]; state?: { data?: { pages?: { body?: { ranking?: { list?: RawPageRow[] } } }[] } } }[] };
  };
  const query = (root?.vueQueryState?.queries ?? []).find((q) => {
    const k = q.queryKey ?? [];
    return k[0] === 'rankings' && k[1] === 'list' && (k[k.length - 1] as { Type?: string } | undefined)?.Type === 'olympic';
  });
  const list = (query?.state?.data?.pages ?? []).flatMap((p) => p.body?.ranking?.list ?? []);
  if (!list.length) throw new Error('olympic page: no Olympic ranking list in the payload');
  const out: OlympicPageRow[] = [];
  for (const r of list) {
    const gender = r.judoka?.gender === 'f' ? 'f' : r.judoka?.gender === 'm' ? 'm' : null;
    const weight = r.weightCategory?.name ?? '';
    if (!gender || !WEIGHTS.sen[gender].includes(weight) || !r.judoka?.idJudoka) continue;
    out.push({
      idPerson: Number(r.judoka.idJudoka), category: `sen-${gender}${weight}`, points: Number(r.totalPoints),
      place: Number(r.place), status: r.ogq?.status?.idStatus ?? null,
    });
  }
  return out;
}
