import { describe, it, expect } from 'vitest';
import { computeInputHash, formatContextScoreForAttio } from './companyContextScore.js';
import { FIELD_SLUGS } from '../apis/attio.js';

describe('computeInputHash', () => {
  it('produces the same hash on repeat calls', () => {
    const values = { a: 'foo', b: 'bar' };
    const slugs = ['a', 'b'];
    expect(computeInputHash(values, slugs)).toBe(computeInputHash(values, slugs));
  });

  it('changes hash when any single cell changes', () => {
    const slugs = ['a', 'b'];
    const h1 = computeInputHash({ a: 'x', b: 'y' }, slugs);
    const h2 = computeInputHash({ a: 'x', b: 'CHANGED' }, slugs);
    expect(h1).not.toBe(h2);
  });

  it('handles missing keys as empty string without throwing', () => {
    const slugs = ['a', 'missing'];
    expect(() => computeInputHash({ a: 'x' }, slugs)).not.toThrow();
    const h = computeInputHash({ a: 'x' }, slugs);
    const hExplicit = computeInputHash({ a: 'x', missing: '' }, slugs);
    expect(h).toBe(hExplicit);
  });

  it('returns a 64-char hex string', () => {
    const h = computeInputHash({ x: 'v' }, ['x']);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('formatContextScoreForAttio', () => {
  it('formats score and reasoning with blank line between', () => {
    const result = formatContextScoreForAttio({ score: 4.5, reasoning: 'High-scale B2C.' });
    expect(result).toBe('4.5\n\nReasoning: High-scale B2C.');
  });

  it('works for score 0', () => {
    const result = formatContextScoreForAttio({ score: 0, reasoning: 'No fit.' });
    expect(result).toBe('0\n\nReasoning: No fit.');
  });
});

describe('FIELD_SLUGS coverage for FIELDS_FOR_PROMPT', () => {
  const FIELDS_FOR_PROMPT = [
    'Description',
    'Industry',
    'Digital Native',
    'Number of Users',
    'Revenue Growth',
    'Funding Growth',
    'Competitor Tooling',
    'Number of Engineers',
    'Number of SREs',
    'Engineer Hiring',
    'SRE Hiring',
    'Observability Tool',
    'Cloud Tool',
    'Communication Tool',
    'Customer complains on X',
    'Recent incidents ( Official )',
    'AI adoption mindset',
    'AI SRE maturity',
  ] as const;

  it('every FIELDS_FOR_PROMPT entry resolves to a known FIELD_SLUGS key', () => {
    for (const field of FIELDS_FOR_PROMPT) {
      expect(FIELD_SLUGS[field], `FIELD_SLUGS missing entry for "${field}"`).toBeTruthy();
    }
  });
});
