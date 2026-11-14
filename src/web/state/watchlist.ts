// The watch list: athlete ids kept in localStorage, shared as #/watch?ids=1,2,3. Storage can be unavailable
// (private mode, blocked site data): everything then degrades to an empty, unsaved list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const WATCHLIST_KEY = 'watchlist.v1';

const isId = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const unique = (ids: number[]) => ids.filter((id, i) => ids.indexOf(id) === i);

export function loadWatchlist(): number[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? unique(v.filter(isId)) : [];
  } catch {
    return [];
  }
}

export function saveWatchlist(ids: number[]): void {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(ids));
  } catch {
    /* unavailable or full: the list lives for this visit only */
  }
}

export const encodeWatchlist = (ids: number[]): string => ids.join(',');

export const MAX_SHARED_IDS = 500;

/** "1,a,,3" -> [1, 3]: anything that is not a positive integer id is dropped, duplicates too; at most 500 ids. */
export function decodeWatchlist(s: string): number[] {
  const out = new Set<number>();
  for (const part of s.split(',')) {
    const x = part.trim();
    if (!/^\d+$/.test(x)) continue;
    const n = Number(x);
    if (isId(n)) out.add(n);
    if (out.size >= MAX_SHARED_IDS) break;
  }
  return [...out];
}

export interface Watchlist {
  ids: number[];
  /** Stable identity: lets memoised rows take it as a prop. */
  has: (id: number) => boolean;
  set: ReadonlySet<number>;
  toggle: (id: number) => void;
  addMany: (ids: number[]) => void;
}

export function useWatchlist(): Watchlist {
  const [ids, setIds] = useState<number[]>(loadWatchlist);
  const ref = useRef(ids);
  const commit = useCallback((next: number[]) => {
    ref.current = next;
    saveWatchlist(next);
    setIds(next);
  }, []);
  const toggle = useCallback((id: number) => {
    const cur = ref.current;
    commit(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }, [commit]);
  const addMany = useCallback((more: number[]) => {
    const next = unique([...ref.current, ...more.filter(isId)]);
    if (next.length !== ref.current.length) commit(next);
  }, [commit]);
  // another tab changed the list
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== WATCHLIST_KEY) return;
      const next = loadWatchlist();
      ref.current = next;
      setIds(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const set = useMemo<ReadonlySet<number>>(() => new Set(ids), [ids]);
  const has = useCallback((id: number) => ref.current.includes(id), []);
  return { ids, has, set, toggle, addMany };
}
