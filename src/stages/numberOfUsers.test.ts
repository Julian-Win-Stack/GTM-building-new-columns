import { describe, it, expect } from 'vitest';
import {
  parseNumberOfUsersResponse,
  formatNumberOfUsersForAttio,
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
        { domain: 'acme.com', user_count: '10,000 customers', reasoning: 'From press release', source_link: 'https://example.com', source_date: '2024-03-15', confidence: 'high' },
      ],
    });
    const companies: StageCompany[] = [{ companyName: 'Acme', domain: 'acme.com' }];
    const out = parseNumberOfUsersResponse(raw, companies);
    expect(out).toHaveLength(1);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data).toEqual({ user_count: '10,000 customers', reasoning: 'From press release', source_link: 'https://example.com', source_date: '2024-03-15', confidence: 'high' });
  });

  it('parses two companies', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', user_count: '~500K MAU (estimated)', reasoning: 'inferred from traffic', source_link: 'https://a.com', source_date: 'Q1 2024', confidence: 'medium' },
        { domain: 'beta.io', user_count: '1M registered', reasoning: 'blog post', source_link: 'https://b.com', source_date: '2024', confidence: 'high' },
      ],
    });
    const companies: StageCompany[] = [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ];
    const out = parseNumberOfUsersResponse(raw, companies);
    expect(out[0]!.data?.user_count).toBe('~500K MAU (estimated)');
    expect(out[0]!.data?.source_date).toBe('Q1 2024');
    expect(out[0]!.data?.confidence).toBe('medium');
    expect(out[1]!.data?.user_count).toBe('1M registered');
    expect(out[1]!.data?.source_date).toBe('2024');
    expect(out[1]!.data?.confidence).toBe('high');
  });

  it('strips www. from domain when matching', () => {
    const raw = buildResponse({
      companies: [{ domain: 'www.acme.com', user_count: '5,000', reasoning: 'from blog', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'high' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases domain when matching', () => {
    const raw = buildResponse({
      companies: [{ domain: 'ACME.COM', user_count: '100K', reasoning: 'estimate', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'low' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases confidence before validating', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '~5K (estimated)', reasoning: 'signals', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'High' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.confidence).toBe('high');
  });

  it('rejects items with empty user_count', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '', reasoning: 'none', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'low' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('rejects items with invalid confidence value', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '10K', reasoning: 'signals', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'very-high' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('returns error when company is missing from response', () => {
    const raw = buildResponse({ companies: [] });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Missing', domain: 'missing.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('returns error when Exa returns content as a JSON string', () => {
    const raw = buildResponse(JSON.stringify({
      companies: [{ domain: 'acme.com', user_count: '10K', reasoning: 'blog', source_link: 'https://x.com', source_date: '2024-02-01', confidence: 'high' }],
    }));
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('accepts empty reasoning, source_link, and source_date when confidence is present', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: 'Insufficient data', reasoning: '', source_link: '', source_date: '', confidence: 'low' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.user_count).toBe('Insufficient data');
    expect(out[0]!.data?.source_date).toBe('');
  });

  it('defaults source_date to empty string when missing from response', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '10K', reasoning: 'blog', source_link: 'https://x.com', confidence: 'high' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.source_date).toBe('');
  });
});

describe('formatNumberOfUsersForAttio', () => {
  it('renders all fields with blank lines between sections', () => {
    const data: NumberOfUsersData = { user_count: '10,000 customers', reasoning: 'From press release', source_link: 'https://example.com', source_date: '2024-03-15', confidence: 'high' };
    expect(formatNumberOfUsersForAttio(data)).toBe(
      'User count: 10,000 customers\n\nReasoning: From press release\n\nSource link: https://example.com\n\nSource date: 2024-03-15\n\nConfidence: high'
    );
  });

  it('omits reasoning when empty', () => {
    const data: NumberOfUsersData = { user_count: '~500K MAU (estimated)', reasoning: '', source_link: 'https://x.com', source_date: 'Q1 2024', confidence: 'medium' };
    expect(formatNumberOfUsersForAttio(data)).toBe('User count: ~500K MAU (estimated)\n\nSource link: https://x.com\n\nSource date: Q1 2024\n\nConfidence: medium');
  });

  it('omits source_link when empty', () => {
    const data: NumberOfUsersData = { user_count: 'Insufficient data', reasoning: 'No signals found', source_link: '', source_date: '2024', confidence: 'low' };
    expect(formatNumberOfUsersForAttio(data)).toBe('User count: Insufficient data\n\nReasoning: No signals found\n\nSource date: 2024\n\nConfidence: low');
  });

  it('omits source_date when empty', () => {
    const data: NumberOfUsersData = { user_count: '10K', reasoning: 'blog', source_link: 'https://x.com', source_date: '', confidence: 'high' };
    expect(formatNumberOfUsersForAttio(data)).toBe('User count: 10K\n\nReasoning: blog\n\nSource link: https://x.com\n\nConfidence: high');
  });

  it('renders only user_count and confidence when reasoning, source_link, and source_date are all empty', () => {
    const data: NumberOfUsersData = { user_count: 'Insufficient data', reasoning: '', source_link: '', source_date: '', confidence: 'low' };
    expect(formatNumberOfUsersForAttio(data)).toBe('User count: Insufficient data\n\nConfidence: low');
  });

  it('always includes confidence', () => {
    const data: NumberOfUsersData = { user_count: '~5K (estimated)', reasoning: '', source_link: '', source_date: '', confidence: 'medium' };
    expect(formatNumberOfUsersForAttio(data)).toContain('Confidence: medium');
  });
});
