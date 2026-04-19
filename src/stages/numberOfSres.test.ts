import { describe, it, expect } from 'vitest';
import { parseNumberOfSresResponse, formatNumberOfSresForAttio } from './numberOfSres.js';
import type { StageCompany } from './types.js';

const company: StageCompany = { companyName: 'Acme', domain: 'acme.com' };

describe('formatNumberOfSresForAttio', () => {
  it('formats count + URLs with a blank line separator', () => {
    const d = { count: 2, linkedinUrls: ['https://linkedin.com/in/a', 'https://linkedin.com/in/b'] };
    expect(formatNumberOfSresForAttio(d)).toBe('2\n\nhttps://linkedin.com/in/a\nhttps://linkedin.com/in/b');
  });

  it('formats zero count with no URLs as "0"', () => {
    expect(formatNumberOfSresForAttio({ count: 0, linkedinUrls: [] })).toBe('0');
  });

  it('formats count-only when items had no linkedinUrl fields', () => {
    expect(formatNumberOfSresForAttio({ count: 3, linkedinUrls: [] })).toBe('3');
  });

  it('formats missing LinkedIn URL as "N/A"', () => {
    expect(formatNumberOfSresForAttio({ count: 0, linkedinUrls: [], na: true })).toBe('N/A');
  });
});

describe('parseNumberOfSresResponse', () => {
  it('counts items and extracts linkedinUrls', () => {
    const items = [
      { linkedinUrl: 'https://linkedin.com/in/a' },
      { linkedinUrl: 'https://linkedin.com/in/b' },
    ];
    const results = parseNumberOfSresResponse({ items }, [company]);
    expect(results).toHaveLength(1);
    expect(results[0]!.data).toEqual({
      count: 2,
      linkedinUrls: ['https://linkedin.com/in/a', 'https://linkedin.com/in/b'],
    });
  });

  it('skips items with no linkedinUrl field', () => {
    const items = [{ linkedinUrl: 'https://linkedin.com/in/a' }, { name: 'No URL' }];
    const results = parseNumberOfSresResponse({ items }, [company]);
    expect(results[0]!.data).toEqual({ count: 2, linkedinUrls: ['https://linkedin.com/in/a'] });
  });

  it('defaults to empty when items array is empty', () => {
    const results = parseNumberOfSresResponse({ items: [] }, [company]);
    expect(results[0]!.data).toEqual({ count: 0, linkedinUrls: [] });
  });

  it('defaults to empty when items is undefined', () => {
    const results = parseNumberOfSresResponse({ items: undefined as unknown as [] }, [company]);
    expect(results[0]!.data).toEqual({ count: 0, linkedinUrls: [] });
  });

  it('returns empty array when companies array is empty', () => {
    expect(parseNumberOfSresResponse({ items: [{ linkedinUrl: 'x' }] }, [])).toHaveLength(0);
  });
});
