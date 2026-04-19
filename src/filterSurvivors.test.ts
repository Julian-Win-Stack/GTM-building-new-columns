import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { filterSurvivors, filterCachedSurvivors } from './filterSurvivors.js';
import type { StageCompany, StageResult } from './stages/types.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('filterSurvivors', () => {
  it('returns only companies that pass the gate', () => {
    const results: StageResult<{ ok: boolean }>[] = [
      { company: { companyName: 'A', domain: 'a.com' }, data: { ok: true } },
      { company: { companyName: 'B', domain: 'b.com' }, data: { ok: false } },
      { company: { companyName: 'C', domain: 'c.com' }, data: { ok: true } },
    ];
    const survivors = filterSurvivors('s', results, (d) => d.ok);
    expect(survivors.map((c) => c.domain)).toEqual(['a.com', 'c.com']);
  });

  it('excludes errored results from survivors regardless of gate', () => {
    const results: StageResult<{ ok: boolean }>[] = [
      { company: { companyName: 'A', domain: 'a.com' }, error: 'boom' },
      { company: { companyName: 'B', domain: 'b.com' }, data: { ok: true } },
    ];
    const survivors = filterSurvivors('s', results, () => true);
    expect(survivors.map((c) => c.domain)).toEqual(['b.com']);
  });

  it('returns an empty array when nothing passes', () => {
    const results: StageResult<{ ok: boolean }>[] = [
      { company: { companyName: 'A', domain: 'a.com' }, data: { ok: false } },
      { company: { companyName: 'B', domain: 'b.com' }, data: { ok: false } },
    ];
    expect(filterSurvivors('s', results, (d) => d.ok)).toEqual([]);
  });

  it('preserves company order from the input', () => {
    const results: StageResult<number>[] = [
      { company: { companyName: 'A', domain: 'a.com' }, data: 1 },
      { company: { companyName: 'B', domain: 'b.com' }, data: 2 },
      { company: { companyName: 'C', domain: 'c.com' }, data: 3 },
    ];
    const survivors = filterSurvivors('s', results, () => true);
    expect(survivors.map((c) => c.domain)).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('logs the stage name with passed/rejected/errored counts', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const results: StageResult<{ ok: boolean }>[] = [
      { company: { companyName: 'A', domain: 'a.com' }, data: { ok: true } },
      { company: { companyName: 'B', domain: 'b.com' }, data: { ok: false } },
      { company: { companyName: 'C', domain: 'c.com' }, error: 'e' },
    ];
    filterSurvivors('myStage', results, (d) => d.ok);
    const line = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(line).toContain('myStage');
    expect(line).toContain('passed=1');
    expect(line).toContain('rejected=1');
    expect(line).toContain('errored=1');
  });
});

describe('filterCachedSurvivors', () => {
  const done: StageCompany[] = [
    { companyName: 'A', domain: 'a.com' },
    { companyName: 'B', domain: 'b.com' },
    { companyName: 'C', domain: 'c.com' },
  ];
  const cache = new Map<string, Record<string, string>>([
    ['a.com', { slug: 'pass' }],
    ['b.com', { slug: 'fail' }],
    ['c.com', { slug: 'pass' }],
  ]);

  it('returns only companies whose cached value passes the cache gate', () => {
    const survivors = filterCachedSurvivors('s', done, cache, 'slug', (v) => v === 'pass');
    expect(survivors.map((c) => c.domain)).toEqual(['a.com', 'c.com']);
  });

  it('rejects a company whose cache entry is missing for the slug', () => {
    const partialCache = new Map<string, Record<string, string>>([['a.com', { slug: 'pass' }]]);
    const survivors = filterCachedSurvivors('s', done, partialCache, 'slug', (v) => v === 'pass');
    expect(survivors.map((c) => c.domain)).toEqual(['a.com']);
  });

  it('returns empty array when done list is empty', () => {
    const survivors = filterCachedSurvivors('s', [], cache, 'slug', () => true);
    expect(survivors).toEqual([]);
  });

  it('logs passed/rejected counts when done is non-empty', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    filterCachedSurvivors('myStage', done, cache, 'slug', (v) => v === 'pass');
    const line = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(line).toContain('myStage');
    expect(line).toContain('cached');
    expect(line).toContain('passed=2');
    expect(line).toContain('rejected=1');
  });
});
