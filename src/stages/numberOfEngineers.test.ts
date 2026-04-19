import { describe, it, expect } from 'vitest';
import { parseNumberOfEngineersResponse, formatNumberOfEngineersForAttio } from './numberOfEngineers.js';
import type { StageCompany } from './types.js';

const company: StageCompany = { companyName: 'Acme', domain: 'acme.com' };

describe('formatNumberOfEngineersForAttio', () => {
  it('formats a non-zero count as a plain number string', () => {
    expect(formatNumberOfEngineersForAttio({ count: 47 })).toBe('47');
  });

  it('formats zero count as "0"', () => {
    expect(formatNumberOfEngineersForAttio({ count: 0 })).toBe('0');
  });
});

describe('parseNumberOfEngineersResponse', () => {
  it('parses total_entries from response', () => {
    const results = parseNumberOfEngineersResponse({ total_entries: 47 }, [company]);
    expect(results).toHaveLength(1);
    expect(results[0]!.data).toEqual({ count: 47 });
    expect(results[0]!.company).toEqual(company);
  });

  it('defaults to 0 when total_entries is missing', () => {
    const results = parseNumberOfEngineersResponse({ total_entries: undefined as unknown as number }, [company]);
    expect(results[0]!.data).toEqual({ count: 0 });
  });

  it('returns empty array when companies array is empty', () => {
    const results = parseNumberOfEngineersResponse({ total_entries: 10 }, []);
    expect(results).toHaveLength(0);
  });
});
