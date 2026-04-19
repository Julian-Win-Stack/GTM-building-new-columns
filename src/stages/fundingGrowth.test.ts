import { describe, it, expect } from 'vitest';
import {
  parseFundingGrowthResponse,
  formatFundingGrowthForAttio,
  type FundingGrowthData,
} from './fundingGrowth.js';
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

describe('parseFundingGrowthResponse', () => {
  it('parses a well-formed response for a single company', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', growth: 'Series B, $50M', timeframe: 'March 2024', evidence: 'https://example.com/funding' },
      ],
    });
    const companies: StageCompany[] = [{ companyName: 'Acme', domain: 'acme.com' }];
    const out = parseFundingGrowthResponse(raw, companies);
    expect(out).toHaveLength(1);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data).toEqual({ growth: 'Series B, $50M', timeframe: 'March 2024', evidence: 'https://example.com/funding' });
  });

  it('parses two companies', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', growth: 'Seed, $2M', timeframe: 'Q1 2023', evidence: 'https://a.com' },
        { domain: 'beta.io', growth: 'Series A, $15M', timeframe: 'Q3 2024', evidence: 'https://b.com' },
      ],
    });
    const companies: StageCompany[] = [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ];
    const out = parseFundingGrowthResponse(raw, companies);
    expect(out[0]!.data?.growth).toBe('Seed, $2M');
    expect(out[1]!.data?.growth).toBe('Series A, $15M');
  });

  it('strips www. from domain when matching', () => {
    const raw = buildResponse({
      companies: [{ domain: 'www.acme.com', growth: 'Series C, $100M', timeframe: 'Jan 2024', evidence: 'https://x.com' }],
    });
    const out = parseFundingGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases domain when matching', () => {
    const raw = buildResponse({
      companies: [{ domain: 'ACME.COM', growth: 'Seed, $1M', timeframe: '2024', evidence: 'https://x.com' }],
    });
    const out = parseFundingGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('returns error when company is missing from response', () => {
    const raw = buildResponse({ companies: [{ domain: 'other.com', growth: 'Series A, $10M', timeframe: '2024', evidence: 'https://x.com' }] });
    const out = parseFundingGrowthResponse(raw, [{ companyName: 'Missing', domain: 'missing.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('skips items with empty growth field', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', growth: '', timeframe: '2024', evidence: 'https://x.com' }],
    });
    const out = parseFundingGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('accepts empty timeframe and evidence', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', growth: 'Series B, $50M', timeframe: '', evidence: '' }],
    });
    const out = parseFundingGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.growth).toBe('Series B, $50M');
  });

  it('returns error when Exa returns content as a JSON string', () => {
    const raw = buildResponse(JSON.stringify({
      companies: [{ domain: 'acme.com', growth: 'Series A, $10M', timeframe: '2024', evidence: 'https://x.com' }],
    }));
    const out = parseFundingGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('handles empty companies array', () => {
    const raw = buildResponse({ companies: [] });
    const out = parseFundingGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });
});

describe('formatFundingGrowthForAttio', () => {
  it('renders all fields with blank lines between sections', () => {
    const data: FundingGrowthData = { growth: 'Series B, $50M', timeframe: 'March 2024', evidence: 'https://example.com' };
    expect(formatFundingGrowthForAttio(data)).toBe('Growth: Series B, $50M\n\nTimeframe: March 2024\n\nEvidence: https://example.com');
  });

  it('omits timeframe when empty', () => {
    const data: FundingGrowthData = { growth: 'Seed, $1M', timeframe: '', evidence: 'https://x.com' };
    expect(formatFundingGrowthForAttio(data)).toBe('Growth: Seed, $1M\n\nEvidence: https://x.com');
  });

  it('omits evidence when empty', () => {
    const data: FundingGrowthData = { growth: 'Series A, $10M', timeframe: 'Q2 2024', evidence: '' };
    expect(formatFundingGrowthForAttio(data)).toBe('Growth: Series A, $10M\n\nTimeframe: Q2 2024');
  });

  it('renders only growth when both timeframe and evidence are empty', () => {
    const data: FundingGrowthData = { growth: 'Not publicly disclosed', timeframe: '', evidence: '' };
    expect(formatFundingGrowthForAttio(data)).toBe('Growth: Not publicly disclosed');
  });
});
