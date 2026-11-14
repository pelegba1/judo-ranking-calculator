import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBreakdownPage } from '../../src/data/breakdown';

const load = (id: number) =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'breakdown', `${id}.html`), 'utf8');
const sum = (rows: { points: number }[]) => rows.reduce((s, r) => s + r.points, 0);

describe('parseBreakdownPage', () => {
  it('parses the senior breakdown of 20144', () => {
    const p = parseBreakdownPage(load(20144));
    expect(p.rankedOn).toBe('2026-11-02');
    expect(p.age).toBe('sen');
    expect(p.rows).toHaveLength(12);
    expect(sum(p.rows.filter((r) => r.percent === 100))).toBe(4308);
    expect(sum(p.rows.filter((r) => r.percent === 50))).toBe(1165);
    expect(p.rows[0]).toMatchObject({
      date: '2026-10-29',
      placeLabel: '1. place',
      points: 1000,
      competitionCode: 'gs_uae2026',
    });
  });

  it('parses the cadet breakdown of 97658', () => {
    const p = parseBreakdownPage(load(97658));
    expect(p.age).toBe('cad');
    expect(p.rows).toHaveLength(5);
    expect(sum(p.rows)).toBe(1110);
  });

  it('parses 75902 without error', () => {
    const p = parseBreakdownPage(load(75902));
    expect(p.rows).toHaveLength(11);
    for (const r of p.rows) expect(r.competitionCode).not.toBeNull();
  });

  it('throws when the payload is missing', () => {
    const html = load(20144).replace(/<script[^>]*id="__NUXT_DATA__"[\s\S]*?<\/script>/, '');
    expect(() => parseBreakdownPage(html)).toThrow(/payload missing/);
  });

  it('throws when the payload is not valid JSON', () => {
    const html = load(20144).replace(/(id="__NUXT_DATA__"[^>]*>)[\s\S]*?</, '$1{oops<');
    expect(() => parseBreakdownPage(html)).toThrow(/not parseable/);
  });

  it('throws when no rows can be parsed (markup drift)', () => {
    const html = load(20144).replace(/class="order-1/g, 'class="x-1');
    expect(() => parseBreakdownPage(html)).toThrow(/no rows parsed/);
  });

  it('throws when a row has no matching payload entry', () => {
    const html = load(20144).replace('Abu Dhabi Grand Slam 2026</span>', 'Other Event</span>');
    expect(() => parseBreakdownPage(html)).toThrow(/candidate codes/);
  });
});
