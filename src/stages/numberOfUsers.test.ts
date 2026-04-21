import { describe, it, expect } from 'vitest';
import {
  parseNumberOfUsersResponse,
  formatNumberOfUsersForAttio,
  extractUserCountBucketFromCached,
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
        { domain: 'acme.com', user_count: '10,000 customers', user_count_bucket: '10K–100K', reasoning: 'From press release', source_link: 'https://example.com', source_date: '2024-03-15', confidence: 'high' },
      ],
    });
    const companies: StageCompany[] = [{ companyName: 'Acme', domain: 'acme.com' }];
    const out = parseNumberOfUsersResponse(raw, companies);
    expect(out).toHaveLength(1);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data).toEqual({ user_count: '10,000 customers', user_count_bucket: '10K–100K', reasoning: 'From press release', source_link: 'https://example.com', source_date: '2024-03-15', confidence: 'high' });
  });

  it('parses two companies', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', user_count: '~500K MAU per 2024 blog', user_count_bucket: '100K+', reasoning: 'blog post', source_link: 'https://a.com', source_date: 'Q1 2024', confidence: 'medium' },
        { domain: 'beta.io', user_count: '1M registered', user_count_bucket: '100K+', reasoning: 'official post', source_link: 'https://b.com', source_date: '2024', confidence: 'high' },
      ],
    });
    const companies: StageCompany[] = [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ];
    const out = parseNumberOfUsersResponse(raw, companies);
    expect(out[0]!.data?.user_count_bucket).toBe('100K+');
    expect(out[1]!.data?.user_count_bucket).toBe('100K+');
  });

  it('parses unknown bucket', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', user_count: 'unknown', user_count_bucket: 'unknown', reasoning: 'No public data found', source_link: '', source_date: '', confidence: 'low' },
      ],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.user_count_bucket).toBe('unknown');
  });

  it('strips www. from domain when matching', () => {
    const raw = buildResponse({
      companies: [{ domain: 'www.acme.com', user_count: '5,000', user_count_bucket: '1K–10K', reasoning: 'from blog', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'high' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases domain when matching', () => {
    const raw = buildResponse({
      companies: [{ domain: 'ACME.COM', user_count: '100K', user_count_bucket: '100K+', reasoning: 'estimate', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'low' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases confidence before validating', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '~5K', user_count_bucket: '1K–10K', reasoning: 'signals', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'High' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.confidence).toBe('high');
  });

  it('rejects items with empty user_count', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '', user_count_bucket: 'unknown', reasoning: 'none', source_link: '', source_date: '', confidence: 'low' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('rejects items with invalid bucket value', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '10K', user_count_bucket: '10K-100K', reasoning: 'signals', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'low' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('rejects items with invalid confidence value', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '10K', user_count_bucket: '10K–100K', reasoning: 'signals', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'very-high' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('returns error when Exa returns content as a JSON string', () => {
    const raw = buildResponse(JSON.stringify({
      companies: [{ domain: 'acme.com', user_count: '10K', user_count_bucket: '10K–100K', reasoning: 'blog', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'high' }],
    }));
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('accepts empty reasoning, source_link, and source_date', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: 'unknown', user_count_bucket: 'unknown', reasoning: '', source_link: '', source_date: '', confidence: 'low' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.source_date).toBe('');
  });

  it('defaults source_date to empty string when missing from response', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '10K', user_count_bucket: '10K–100K', reasoning: 'blog', source_link: 'https://x.com', confidence: 'high' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.source_date).toBe('');
  });

  it('returns error when company is missing from response', () => {
    const raw = buildResponse({ companies: [] });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Missing', domain: 'missing.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });
});

describe('formatNumberOfUsersForAttio', () => {
  it('renders all fields with blank lines between sections', () => {
    const data: NumberOfUsersData = { user_count: '10,000 customers', user_count_bucket: '10K–100K', reasoning: 'From press release', source_link: 'https://example.com', source_date: '2024-03-15', confidence: 'high' };
    expect(formatNumberOfUsersForAttio(data)).toBe(
      'User count: 10,000 customers\n\nUser count bucket: 10K–100K\n\nReasoning: From press release\n\nSource link: https://example.com\n\nSource date: 2024-03-15\n\nConfidence: high'
    );
  });

  it('renders unknown bucket in full entry (no sentinel)', () => {
    const data: NumberOfUsersData = { user_count: 'unknown', user_count_bucket: 'unknown', reasoning: 'No public data found', source_link: '', source_date: '', confidence: 'low' };
    expect(formatNumberOfUsersForAttio(data)).toContain('User count bucket: unknown');
    expect(formatNumberOfUsersForAttio(data)).toContain('Confidence: low');
  });

  it('omits reasoning when empty', () => {
    const data: NumberOfUsersData = { user_count: '~500K MAU', user_count_bucket: '100K+', reasoning: '', source_link: 'https://x.com', source_date: 'Q1 2024', confidence: 'medium' };
    expect(formatNumberOfUsersForAttio(data)).not.toContain('Reasoning:');
  });

  it('omits source_link when empty', () => {
    const data: NumberOfUsersData = { user_count: 'unknown', user_count_bucket: 'unknown', reasoning: 'No signals', source_link: '', source_date: '2024', confidence: 'low' };
    expect(formatNumberOfUsersForAttio(data)).not.toContain('Source link:');
  });

  it('always includes confidence', () => {
    const data: NumberOfUsersData = { user_count: '~5K', user_count_bucket: '1K–10K', reasoning: '', source_link: '', source_date: '', confidence: 'medium' };
    expect(formatNumberOfUsersForAttio(data)).toContain('Confidence: medium');
  });
});

describe('extractUserCountBucketFromCached', () => {
  it('extracts bucket from a full formatted Attio value', () => {
    const cached = 'User count: ~500K MAU\n\nUser count bucket: 100K+\n\nReasoning: signals\n\nConfidence: medium';
    expect(extractUserCountBucketFromCached(cached)).toBe('100K+');
  });

  it('extracts unknown bucket', () => {
    expect(extractUserCountBucketFromCached('User count: unknown\n\nUser count bucket: unknown\n\nConfidence: low')).toBe('unknown');
  });

  it('returns null when the bucket line is absent (old format compatibility)', () => {
    expect(extractUserCountBucketFromCached('User count: ~5K (estimated)\n\nUser count (numeric): 5000\n\nConfidence: low')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractUserCountBucketFromCached('')).toBeNull();
  });

  it('returns null for the old single-line sentinel (old format compatibility)', () => {
    expect(extractUserCountBucketFromCached('No user count found (even estimate)')).toBeNull();
  });

  it('returns null when the bucket value is not valid', () => {
    expect(extractUserCountBucketFromCached('User count bucket: 10K-100K')).toBeNull();
  });

  it('extracts all valid bucket values', () => {
    for (const bucket of ['<100', '100–1K', '1K–10K', '10K–100K', '100K+', 'unknown'] as const) {
      expect(extractUserCountBucketFromCached(`User count bucket: ${bucket}`)).toBe(bucket);
    }
  });
});
