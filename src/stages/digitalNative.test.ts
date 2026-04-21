import { describe, it, expect } from 'vitest';
import {
  parseDigitalNativeResponse,
  digitalNativeGate,
  formatDigitalNativeForAttio,
  digitalNativeCacheGate,
  getDigitalNativeCategoryFromCached,
  type DigitalNativeData,
} from './digitalNative.js';
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

describe('parseDigitalNativeResponse', () => {
  it('parses a well-formed structured response for a single company', () => {
    const raw = buildResponse({
      companies: [
        {
          domain: 'acme.com',
          category: 'Digital-native B2C',
          confidence: 'High',
          reason: 'Sells consumer apps.',
          source_links: ['https://acme.com', 'https://acme.com/about'],
        },
      ],
    });
    const companies: StageCompany[] = [{ companyName: 'Acme', domain: 'acme.com' }];
    const out = parseDigitalNativeResponse(raw, companies);
    expect(out).toHaveLength(1);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data).toEqual({
      category: 'Digital-native B2C',
      confidence: 'High',
      reason: 'Sells consumer apps.',
      source_links: ['https://acme.com', 'https://acme.com/about'],
    });
  });

  it('parses multiple companies in the structured response', () => {
    const raw = buildResponse({
      companies: [
        {
          domain: 'acme.com',
          category: 'Digital-native B2C',
          confidence: 'High',
          reason: 'Consumer app.',
          source_links: [],
        },
        {
          domain: 'beta.io',
          category: 'Digital-native B2B',
          confidence: 'Medium',
          reason: 'SaaS for businesses.',
          source_links: ['https://beta.io'],
        },
      ],
    });
    const companies: StageCompany[] = [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ];
    const out = parseDigitalNativeResponse(raw, companies);
    expect(out[0]!.data?.category).toBe('Digital-native B2C');
    expect(out[1]!.data?.category).toBe('Digital-native B2B');
  });

  it('strips a leading www. from the domain when matching', () => {
    const raw = buildResponse({
      companies: [
        {
          domain: 'www.acme.com',
          category: 'Digital-native B2C',
          confidence: 'High',
          reason: 'ok.',
          source_links: [],
        },
      ],
    });
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
    ]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases the parsed domain when matching', () => {
    const raw = buildResponse({
      companies: [
        {
          domain: 'ACME.com',
          category: 'Digital-native B2C',
          confidence: 'High',
          reason: 'ok.',
          source_links: [],
        },
      ],
    });
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
    ]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('returns "no output from Exa" when a company is not present in the response', () => {
    const raw = buildResponse({
      companies: [
        {
          domain: 'acme.com',
          category: 'Digital-native B2C',
          confidence: 'High',
          reason: 'ok.',
          source_links: [],
        },
      ],
    });
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Missing', domain: 'missing.com' },
    ]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('skips items with missing required fields', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', category: 'Digital-native B2C', confidence: 'High' },
        {
          domain: 'beta.io',
          category: 'Digital-native B2B',
          confidence: 'High',
          reason: 'valid.',
          source_links: [],
        },
      ],
    });
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ]);
    expect(out[0]!.error).toBe('no output from Exa');
    expect(out[1]!.data?.category).toBe('Digital-native B2B');
  });

  it('skips items with an unknown category', () => {
    const raw = buildResponse({
      companies: [
        {
          domain: 'acme.com',
          category: 'Not A Real Category',
          confidence: 'High',
          reason: 'bogus.',
          source_links: [],
        },
      ],
    });
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
    ]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('skips the company when Exa returns content as a JSON string instead of an object', () => {
    const raw = buildResponse(
      JSON.stringify({
        companies: [
          {
            domain: 'acme.com',
            category: 'Digital-native B2C',
            confidence: 'High',
            reason: 'JSON-stringified.',
            source_links: [],
          },
        ],
      })
    );
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
    ]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('handles an empty companies array gracefully', () => {
    const raw = buildResponse({ companies: [] });
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
    ]);
    expect(out[0]!.error).toBe('no output from Exa');
  });
});

describe('digitalNativeGate', () => {
  it('rejects NOT Digital-native', () => {
    expect(
      digitalNativeGate({ category: 'NOT Digital-native', confidence: 'High', reason: 'x', source_links: [] })
    ).toBe(false);
  });

  it('accepts Digital-native B2B', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2B', confidence: 'High', reason: 'x', source_links: [] })
    ).toBe(true);
  });

  it('accepts Digital-native B2C', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2C', confidence: 'High', reason: 'x', source_links: [] })
    ).toBe(true);
  });

  it('accepts Digital-native B2B2C', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2B2C', confidence: 'High', reason: 'x', source_links: [] })
    ).toBe(true);
  });

  it('accepts Digital-native B2C2B', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2C2B', confidence: 'High', reason: 'x', source_links: [] })
    ).toBe(true);
  });
});

describe('formatDigitalNativeForAttio', () => {
  it('renders the documented Attio value format with blank lines between sections', () => {
    const data: DigitalNativeData = {
      category: 'Digital-native B2C',
      confidence: 'High',
      reason: 'Sells consumer apps.',
      source_links: [],
    };
    expect(formatDigitalNativeForAttio(data)).toBe(
      'Digital-native B2C\n\nConfidence: High\n\nReasoning: Sells consumer apps.'
    );
  });

  it('appends a Sources block when source_links are present', () => {
    const data: DigitalNativeData = {
      category: 'Digital-native B2B',
      confidence: 'High',
      reason: 'SaaS for businesses.',
      source_links: ['https://acme.com', 'https://acme.com/about'],
    };
    expect(formatDigitalNativeForAttio(data)).toBe(
      'Digital-native B2B\n\nConfidence: High\n\nReasoning: SaaS for businesses.\n\nSources:\nhttps://acme.com\nhttps://acme.com/about'
    );
  });

  it('omits the Sources block when source_links is empty', () => {
    const data: DigitalNativeData = {
      category: 'Digital-native B2C',
      confidence: 'Low',
      reason: 'No good sources.',
      source_links: [],
    };
    expect(formatDigitalNativeForAttio(data)).not.toContain('Sources:');
  });
});

describe('digitalNativeCacheGate', () => {
  it('passes a B2C cached value', () => {
    expect(
      digitalNativeCacheGate('Digital-native B2C\n\nConfidence: High\n\nReasoning: x')
    ).toBe(true);
  });

  it('passes a B2B cached value', () => {
    expect(
      digitalNativeCacheGate('Digital-native B2B\n\nConfidence: Medium\n\nReasoning: x')
    ).toBe(true);
  });

  it('rejects a NOT Digital-native cached value', () => {
    expect(
      digitalNativeCacheGate('NOT Digital-native\n\nConfidence: High\n\nReasoning: x')
    ).toBe(false);
  });

  it('rejects an empty cached value', () => {
    expect(digitalNativeCacheGate('')).toBe(false);
  });
});

describe('getDigitalNativeCategoryFromCached', () => {
  it('returns the category from the first line of a formatted Attio value', () => {
    const cached = 'Digital-native B2B\n\nConfidence: High\n\nReasoning: sells to businesses';
    expect(getDigitalNativeCategoryFromCached(cached)).toBe('Digital-native B2B');
  });

  it('returns Digital-native B2C', () => {
    expect(getDigitalNativeCategoryFromCached('Digital-native B2C\n\nConfidence: High\n\nReasoning: ...')).toBe('Digital-native B2C');
  });

  it('returns NOT Digital-native', () => {
    expect(getDigitalNativeCategoryFromCached('NOT Digital-native\n\nConfidence: High\n\nReasoning: ...')).toBe('NOT Digital-native');
  });

  it('returns null for an unrecognised first line', () => {
    expect(getDigitalNativeCategoryFromCached('Some random text')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(getDigitalNativeCategoryFromCached('')).toBeNull();
  });
});
