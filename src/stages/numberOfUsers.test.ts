import { describe, it, expect } from 'vitest';
import {
  parseNumberOfUsersResponse,
  formatNumberOfUsersForAttio,
  extractUserCountNumericFromCached,
  type NumberOfUsersData,
} from './numberOfUsers.js';
import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany } from './types.js';

function buildResponse(content: unknown): ExaSearchResponse {
  return {
    results: [],
    searchTime: 0,
    output: { content: content as Record<string, unknown>, grounding: [] },
    costDollars: { total: 0 },
  };
}

describe('parseNumberOfUsersResponse', () => {
  it('parses a well-formed response for a single company', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', user_count: '10,000 customers', user_count_numeric: 10000, reasoning: 'From press release', source_link: 'https://example.com', source_date: '2024-03-15', confidence: 'high' },
      ],
    });
    const companies: StageCompany[] = [{ companyName: 'Acme', domain: 'acme.com' }];
    const out = parseNumberOfUsersResponse(raw, companies);
    expect(out).toHaveLength(1);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data).toEqual({ user_count: '10,000 customers', user_count_numeric: 10000, reasoning: 'From press release', source_link: 'https://example.com', source_date: '2024-03-15', confidence: 'high' });
  });

  it('parses two companies', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', user_count: '~500K MAU (estimated)', user_count_numeric: 500000, reasoning: 'inferred from traffic', source_link: 'https://a.com', source_date: 'Q1 2024', confidence: 'medium' },
        { domain: 'beta.io', user_count: '1M registered', user_count_numeric: 1000000, reasoning: 'blog post', source_link: 'https://b.com', source_date: '2024', confidence: 'high' },
      ],
    });
    const companies: StageCompany[] = [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ];
    const out = parseNumberOfUsersResponse(raw, companies);
    expect(out[0]!.data?.user_count).toBe('~500K MAU (estimated)');
    expect(out[0]!.data?.user_count_numeric).toBe(500000);
    expect(out[1]!.data?.user_count_numeric).toBe(1000000);
  });

  it('defaults user_count_numeric to 0 when missing', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', user_count: 'Insufficient data', reasoning: '', source_link: '', source_date: '', confidence: 'low' },
      ],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.data?.user_count_numeric).toBe(0);
  });

  it('strips www. from domain when matching', () => {
    const raw = buildResponse({
      companies: [{ domain: 'www.acme.com', user_count: '5,000', user_count_numeric: 5000, reasoning: 'from blog', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'high' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases confidence before validating', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '~5K (estimated)', user_count_numeric: 5000, reasoning: 'signals', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'High' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.confidence).toBe('high');
  });

  it('rejects items with empty user_count', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '', user_count_numeric: 0, reasoning: 'none', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'low' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('returns error when company is missing from response', () => {
    const raw = buildResponse({ companies: [] });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Missing', domain: 'missing.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });
});

describe('formatNumberOfUsersForAttio', () => {
  it('renders all fields with blank lines between sections', () => {
    const data: NumberOfUsersData = { user_count: '10,000 customers', user_count_numeric: 10000, reasoning: 'From press release', source_link: 'https://example.com', source_date: '2024-03-15', confidence: 'high' };
    expect(formatNumberOfUsersForAttio(data)).toBe(
      'User count: 10,000 customers\n\nUser count (numeric): 10000\n\nReasoning: From press release\n\nSource link: https://example.com\n\nSource date: 2024-03-15\n\nConfidence: high'
    );
  });

  it('always includes user_count_numeric', () => {
    const data: NumberOfUsersData = { user_count: 'Insufficient data', user_count_numeric: 0, reasoning: '', source_link: '', source_date: '', confidence: 'low' };
    expect(formatNumberOfUsersForAttio(data)).toContain('User count (numeric): 0');
  });

  it('omits reasoning when empty', () => {
    const data: NumberOfUsersData = { user_count: '~500K MAU (estimated)', user_count_numeric: 500000, reasoning: '', source_link: 'https://x.com', source_date: 'Q1 2024', confidence: 'medium' };
    expect(formatNumberOfUsersForAttio(data)).not.toContain('Reasoning:');
  });

  it('omits source_link when empty', () => {
    const data: NumberOfUsersData = { user_count: 'Insufficient data', user_count_numeric: 0, reasoning: 'No signals found', source_link: '', source_date: '2024', confidence: 'low' };
    expect(formatNumberOfUsersForAttio(data)).not.toContain('Source link:');
  });

  it('always includes confidence', () => {
    const data: NumberOfUsersData = { user_count: '~5K (estimated)', user_count_numeric: 5000, reasoning: '', source_link: '', source_date: '', confidence: 'medium' };
    expect(formatNumberOfUsersForAttio(data)).toContain('Confidence: medium');
  });
});

describe('extractUserCountNumericFromCached', () => {
  it('extracts integer from a full formatted Attio value', () => {
    const cached = 'User count: ~500K MAU (estimated)\n\nUser count (numeric): 500000\n\nReasoning: signals\n\nConfidence: medium';
    expect(extractUserCountNumericFromCached(cached)).toBe(500000);
  });

  it('returns 0 when numeric field is 0', () => {
    expect(extractUserCountNumericFromCached('User count: Insufficient data\n\nUser count (numeric): 0\n\nConfidence: low')).toBe(0);
  });

  it('returns null when the numeric line is absent', () => {
    expect(extractUserCountNumericFromCached('User count: ~5K (estimated)\n\nConfidence: low')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractUserCountNumericFromCached('')).toBeNull();
  });

  it('returns null when the value is not a valid number', () => {
    expect(extractUserCountNumericFromCached('User count (numeric): abc')).toBeNull();
  });
});
