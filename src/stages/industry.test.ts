import { describe, it, expect } from 'vitest';
import { parseIndustryResponse, formatIndustryForAttio } from './industry.js';
import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany } from './types.js';

const company1: StageCompany = { companyName: 'Acme', domain: 'acme.com' };
const company2: StageCompany = { companyName: 'Beta', domain: 'beta.io' };

function makeRaw(companies: unknown[]): ExaSearchResponse {
  return {
    results: [],
    searchTime: 0,
    output: { content: { companies } as Record<string, unknown>, grounding: [] },
    costDollars: { total: 0 },
  };
}

function makeRawContent(content: unknown): ExaSearchResponse {
  return {
    results: [],
    searchTime: 0,
    output: { content: content as string | Record<string, unknown>, grounding: [] },
    costDollars: { total: 0 },
  };
}

describe('parseIndustryResponse', () => {
  it('returns data for both companies on a well-formed 2-item payload', () => {
    const raw = makeRaw([
      { domain: 'acme.com', industry: 'SaaS (B2B)', reason: 'Sells software to businesses.' },
      { domain: 'beta.io', industry: 'E-commerce', reason: 'Online retail platform.' },
    ]);
    const results = parseIndustryResponse(raw, [company1, company2]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ company: company1, data: { industry: 'SaaS (B2B)', reason: 'Sells software to businesses.' } });
    expect(results[1]).toMatchObject({ company: company2, data: { industry: 'E-commerce', reason: 'Online retail platform.' } });
  });

  it('returns data (not error) when industry is "Unknown" — valid enum value', () => {
    const raw = makeRaw([
      { domain: 'acme.com', industry: 'Unknown', reason: 'Insufficient information.' },
    ]);
    const results = parseIndustryResponse(raw, [company1]);
    expect(results[0]).toMatchObject({ company: company1, data: { industry: 'Unknown' } });
  });

  it('returns error with off-enum message when Exa emits an industry outside the allowed list', () => {
    const raw = makeRaw([
      { domain: 'acme.com', industry: 'Healthcare', reason: 'Medical software.' },
    ]);
    const results = parseIndustryResponse(raw, [company1]);
    expect(results[0]).toMatchObject({ company: company1, error: 'industry: off-enum value "Healthcare"' });
  });

  it('returns error for a company whose domain is missing from the response', () => {
    const raw = makeRaw([
      { domain: 'beta.io', industry: 'Fintech', reason: 'Payments platform.' },
    ]);
    const results = parseIndustryResponse(raw, [company1, company2]);
    expect(results[0]).toMatchObject({ company: company1, error: 'industry: no data returned' });
    expect(results[1]).toMatchObject({ company: company2, data: { industry: 'Fintech' } });
  });

  it('returns error when output.content is a plain string', () => {
    const raw = makeRawContent('some text');
    const results = parseIndustryResponse(raw, [company1]);
    expect(results[0]).toMatchObject({ company: company1, error: 'industry: no data returned' });
  });

  it('returns error when output is undefined', () => {
    const raw = { results: [], searchTime: 0, output: undefined as unknown as ExaSearchResponse['output'], costDollars: { total: 0 } };
    const results = parseIndustryResponse(raw, [company1]);
    expect(results[0]).toMatchObject({ company: company1, error: 'industry: no data returned' });
  });

  it('normalizes www. prefix in returned domain', () => {
    const raw = makeRaw([
      { domain: 'www.acme.com', industry: 'Gaming', reason: 'Video game publisher.' },
    ]);
    const results = parseIndustryResponse(raw, [company1]);
    expect(results[0]).toMatchObject({ company: company1, data: { industry: 'Gaming' } });
  });
});

describe('formatIndustryForAttio', () => {
  it('emits the two-line industry: / reason: format', () => {
    expect(formatIndustryForAttio({ industry: 'Developer tools / APIs', reason: 'CI/CD pipeline tooling.' }))
      .toBe('industry: Developer tools / APIs\nreason: CI/CD pipeline tooling.');
  });
});
