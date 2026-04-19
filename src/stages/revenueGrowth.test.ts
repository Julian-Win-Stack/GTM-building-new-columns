import { describe, it, expect } from 'vitest';
import {
  parseRevenueGrowthResponse,
  formatRevenueGrowthForAttio,
  type RevenueGrowthData,
} from './revenueGrowth.js';
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

describe('parseRevenueGrowthResponse', () => {
  it('parses a well-formed response for a single company', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', growth: 'Growing ~40% YoY', evidence: 'https://example.com', source_date: '2024-03-15', reasoning: 'Based on headcount growth', confidence: 'medium' },
      ],
    });
    const companies: StageCompany[] = [{ companyName: 'Acme', domain: 'acme.com' }];
    const out = parseRevenueGrowthResponse(raw, companies);
    expect(out).toHaveLength(1);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data).toEqual({ growth: 'Growing ~40% YoY', evidence: 'https://example.com', source_date: '2024-03-15', reasoning: 'Based on headcount growth', confidence: 'medium' });
  });

  it('parses two companies', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', growth: 'Stable', evidence: 'https://a.com', source_date: 'Q1 2024', reasoning: 'No change', confidence: 'low' },
        { domain: 'beta.io', growth: 'Declining', evidence: 'https://b.com', source_date: '2024', reasoning: 'Layoffs', confidence: 'high' },
      ],
    });
    const companies: StageCompany[] = [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ];
    const out = parseRevenueGrowthResponse(raw, companies);
    expect(out[0]!.data?.growth).toBe('Stable');
    expect(out[0]!.data?.source_date).toBe('Q1 2024');
    expect(out[1]!.data?.growth).toBe('Declining');
    expect(out[1]!.data?.source_date).toBe('2024');
  });

  it('strips www. from domain when matching', () => {
    const raw = buildResponse({
      companies: [{ domain: 'www.acme.com', growth: 'Growing', evidence: 'https://x.com', source_date: '2024-01-10', reasoning: 'signals', confidence: 'high' }],
    });
    const out = parseRevenueGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases confidence before validating', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', growth: 'Growing', evidence: 'https://x.com', source_date: '2024-01-10', reasoning: 'signals', confidence: 'High' }],
    });
    const out = parseRevenueGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.confidence).toBe('high');
  });

  it('rejects items with invalid confidence value', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', growth: 'Growing', evidence: 'https://x.com', source_date: '2024-01-10', reasoning: 'signals', confidence: 'very-high' }],
    });
    const out = parseRevenueGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('rejects items with empty growth field', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', growth: '', evidence: 'https://x.com', source_date: '2024-01-10', reasoning: 'signals', confidence: 'high' }],
    });
    const out = parseRevenueGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('returns error when company is missing from response', () => {
    const raw = buildResponse({ companies: [] });
    const out = parseRevenueGrowthResponse(raw, [{ companyName: 'Missing', domain: 'missing.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('returns error when Exa returns content as a JSON string', () => {
    const raw = buildResponse(JSON.stringify({
      companies: [{ domain: 'acme.com', growth: 'Growing', evidence: 'https://x.com', source_date: '2024-01-10', reasoning: 'signals', confidence: 'high' }],
    }));
    const out = parseRevenueGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('accepts empty evidence, source_date, and reasoning', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', growth: 'Insufficient data', evidence: '', source_date: '', reasoning: '', confidence: 'low' }],
    });
    const out = parseRevenueGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.source_date).toBe('');
  });

  it('defaults source_date to empty string when missing from response', () => {
    const raw = buildResponse({
      companies: [{ domain: 'acme.com', growth: 'Growing', evidence: 'https://x.com', reasoning: 'signals', confidence: 'high' }],
    });
    const out = parseRevenueGrowthResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.source_date).toBe('');
  });
});

describe('formatRevenueGrowthForAttio', () => {
  it('renders all fields with blank lines between sections', () => {
    const data: RevenueGrowthData = { growth: 'Growing ~40% YoY', evidence: 'https://example.com', source_date: '2024-03-15', reasoning: 'Based on ARR', confidence: 'medium' };
    expect(formatRevenueGrowthForAttio(data)).toBe(
      'Growth: Growing ~40% YoY\n\nEvidence: https://example.com\n\nSource date: 2024-03-15\n\nReasoning: Based on ARR\n\nConfidence: medium'
    );
  });

  it('omits evidence when empty', () => {
    const data: RevenueGrowthData = { growth: 'Stable', evidence: '', source_date: '2024', reasoning: 'No signals', confidence: 'low' };
    expect(formatRevenueGrowthForAttio(data)).toBe('Growth: Stable\n\nSource date: 2024\n\nReasoning: No signals\n\nConfidence: low');
  });

  it('omits source_date when empty', () => {
    const data: RevenueGrowthData = { growth: 'Declining', evidence: 'https://x.com', source_date: '', reasoning: 'Layoffs', confidence: 'high' };
    expect(formatRevenueGrowthForAttio(data)).toBe('Growth: Declining\n\nEvidence: https://x.com\n\nReasoning: Layoffs\n\nConfidence: high');
  });

  it('omits reasoning when empty', () => {
    const data: RevenueGrowthData = { growth: 'Declining', evidence: 'https://x.com', source_date: 'Q1 2024', reasoning: '', confidence: 'high' };
    expect(formatRevenueGrowthForAttio(data)).toBe('Growth: Declining\n\nEvidence: https://x.com\n\nSource date: Q1 2024\n\nConfidence: high');
  });

  it('always includes confidence', () => {
    const data: RevenueGrowthData = { growth: 'Insufficient data', evidence: '', source_date: '', reasoning: '', confidence: 'low' };
    expect(formatRevenueGrowthForAttio(data)).toContain('Confidence: low');
  });
});
