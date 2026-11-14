import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiGet, getCompetitionInfo, getContests, IjfApiError } from '../../src/data/ijf-api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('apiGet', () => {
  it('builds params[...] query and returns the body', async () => {
    const f = vi.fn(async () => json([{ a: 1 }]));
    vi.stubGlobal('fetch', f);
    const r = await apiGet('x.y', { id_competition: 5 });
    expect(r).toEqual([{ a: 1 }]);
    const url = decodeURIComponent(String((f.mock.calls[0] as unknown[])[0]));
    expect(url).toContain('params[action]=x.y');
    expect(url).toContain('params[id_competition]=5');
  });

  it('throws IjfApiError on an {error} body', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'unknown action 3' }));
    await expect(apiGet('nope')).rejects.toThrow(IjfApiError);
    await expect(apiGet('nope')).rejects.toThrow(/unknown action/);
  });

  it('throws IjfApiError on HTTP error', async () => {
    vi.stubGlobal('fetch', async () => new Response('x', { status: 500 }));
    await expect(apiGet('a')).rejects.toThrow(/HTTP 500/);
  });

  it('throws IjfApiError on non-JSON body', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>', { status: 200 }));
    await expect(apiGet('a')).rejects.toBeInstanceOf(IjfApiError);
  });

  it('throws IjfApiError on network failure', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(apiGet('a')).rejects.toBeInstanceOf(IjfApiError);
  });

  it('aborts and throws IjfApiError after 30 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const p = apiGet('slow');
    const assertion = expect(p).rejects.toThrow(/Timeout/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});

describe('getCompetitionInfo', () => {
  it('returns null for an unused id', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'info.error.id_competition_not_exists' }));
    expect(await getCompetitionInfo(9999999)).toBeNull();
  });

  it('returns null for an object without id_competition', async () => {
    vi.stubGlobal('fetch', async () => json({}));
    expect(await getCompetitionInfo(1)).toBeNull();
  });

  it('rethrows other API errors', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'boom' }));
    await expect(getCompetitionInfo(1)).rejects.toBeInstanceOf(IjfApiError);
  });

  it('returns the info object', async () => {
    vi.stubGlobal('fetch', async () => json({ id_competition: '3157', name: 'X' }));
    expect((await getCompetitionInfo(3157))?.id_competition).toBe('3157');
  });
});

describe('getContests', () => {
  it('unwraps {contests} and accepts bare arrays', async () => {
    vi.stubGlobal('fetch', async () => json({ contests: [{ id_fight: '1' }] }));
    expect(await getContests(1)).toHaveLength(1);
    vi.stubGlobal('fetch', async () => json([{ id_fight: '1' }, { id_fight: '2' }]));
    expect(await getContests(1)).toHaveLength(2);
  });
});
