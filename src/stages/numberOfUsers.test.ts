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
        { domain: 'acme.com', user_count: '10,000 customers', reasoning: 'From press release', source_link: 'https://example.com' },
      ],
    });
    const companies: StageCompany[] = [{ companyName: 'Acme', domain: 'acme.com' }];
    const out = parseNumberOfUsersResponse(raw, companies);
    expect(out).toHaveLength(1);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data).toEqual({ user_count: '10,000 customers', reasoning: 'From press release', source_link: 'https://example.com' });
  });

  it('parses two companies', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', user_count: '500K MAU (estimate)', reasoning: 'inferred from traffic', source_link: 'https://a.com' },
        { domain: 'beta.io', user_count: '1M registered', reasoning: 'blog post', source_link: 'https://b.com' },
      ],
    });
    const companies: StageCompany[] = [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ];
    const out = parseNumberOfUsersResponse(raw, companies);
    expect(out[0]!.data?.user_count).toBe('500K MAU (estimate)');
    expect(out[1]!.data?.user_count).toBe('1M registered');
  });

  it('strips www. from domain when matching', () => {
    const raw = buildResponse({
      companies: [{ domain: 'www.acme.com', user_count: '5,000', reasoning: 'from blog', source_link: 'https://x.com' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases domain when matching', () => {
    const raw = buildResponse({
      companies: [{ domain: 'ACME.COM', user_count: '100K', reasoning: 'estimate', source_link: 'https://x.com' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('rejects items with empty user_count', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: '', reasoning: 'none', source_link: 'https://x.com' }],
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
      companies: [{ domain: 'acme.com', user_count: '10K', reasoning: 'blog', source_link: 'https://x.com' }],
    }));
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('accepts empty reasoning and source_link', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', user_count: 'Not publicly disclosed', reasoning: '', source_link: '' }],
    });
    const out = parseNumberOfUsersResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.user_count).toBe('Not publicly disclosed');
  });
});

describe('formatNumberOfUsersForAttio', () => {
  it('renders all fields with blank lines between sections', () => {
    const data: NumberOfUsersData = { user_count: '10,000 customers', reasoning: 'From press release', source_link: 'https://example.com' };
    expect(formatNumberOfUsersForAttio(data)).toBe(
      'User count: 10,000 customers\n\nReasoning: From press release\n\nSource link: https://example.com'
    );
  });

  it('omits reasoning when empty', () => {
    const data: NumberOfUsersData = { user_count: '500K MAU (estimate)', reasoning: '', source_link: 'https://x.com' };
    expect(formatNumberOfUsersForAttio(data)).toBe('User count: 500K MAU (estimate)\n\nSource link: https://x.com');
  });

  it('omits source_link when empty', () => {
    const data: NumberOfUsersData = { user_count: 'Not publicly disclosed', reasoning: 'Company policy', source_link: '' };
    expect(formatNumberOfUsersForAttio(data)).toBe('User count: Not publicly disclosed\n\nReasoning: Company policy');
  });

  it('renders only user_count when both reasoning and source_link are empty', () => {
    const data: NumberOfUsersData = { user_count: 'Unknown', reasoning: '', source_link: '' };
    expect(formatNumberOfUsersForAttio(data)).toBe('User count: Unknown');
  });
});
