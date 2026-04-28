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
          digital_criticality_signals: [],
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
      digital_criticality_signals: [],
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
          digital_criticality_signals: [],
          source_links: [],
        },
        {
          domain: 'beta.io',
          category: 'Digital-native B2B',
          confidence: 'Medium',
          reason: 'SaaS for businesses.',
          digital_criticality_signals: [],
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
          digital_criticality_signals: [],
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
          digital_criticality_signals: [],
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
          digital_criticality_signals: [],
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
          digital_criticality_signals: [],
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
          digital_criticality_signals: [],
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
  it('rejects NOT Digital-native or digitally critical', () => {
    expect(
      digitalNativeGate({ category: 'NOT Digital-native or digitally critical', confidence: 'High', reason: 'x', digital_criticality_signals: [], source_links: [] })
    ).toBe(false);
  });

  it('rejects legacy NOT Digital-native string', () => {
    expect(
      digitalNativeGate({ category: 'NOT Digital-native', confidence: 'High', reason: 'x', digital_criticality_signals: [], source_links: [] })
    ).toBe(false);
  });

  it('accepts Digital-native B2B', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2B', confidence: 'High', reason: 'x', digital_criticality_signals: [], source_links: [] })
    ).toBe(true);
  });

  it('accepts Digital-native B2C', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2C', confidence: 'High', reason: 'x', digital_criticality_signals: [], source_links: [] })
    ).toBe(true);
  });

  it('accepts Digital-native B2B2C', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2B2C', confidence: 'High', reason: 'x', digital_criticality_signals: [], source_links: [] })
    ).toBe(true);
  });

  it('accepts Digital-native B2C2B', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2C2B', confidence: 'High', reason: 'x', digital_criticality_signals: [], source_links: [] })
    ).toBe(true);
  });

  it('accepts Digitally critical B2C', () => {
    expect(
      digitalNativeGate({ category: 'Digitally critical B2C', confidence: 'High', reason: 'x', digital_criticality_signals: [], source_links: [] })
    ).toBe(true);
  });

  it('accepts Digitally critical B2B', () => {
    expect(
      digitalNativeGate({ category: 'Digitally critical B2B', confidence: 'High', reason: 'x', digital_criticality_signals: [], source_links: [] })
    ).toBe(true);
  });

  it('accepts Digitally critical B2B2C', () => {
    expect(
      digitalNativeGate({ category: 'Digitally critical B2B2C', confidence: 'High', reason: 'x', digital_criticality_signals: [], source_links: [] })
    ).toBe(true);
  });

  it('accepts Digitally critical B2C2B', () => {
    expect(
      digitalNativeGate({ category: 'Digitally critical B2C2B', confidence: 'High', reason: 'x', digital_criticality_signals: [], source_links: [] })
    ).toBe(true);
  });
});

describe('formatDigitalNativeForAttio', () => {
  it('renders the documented Attio value format with blank lines between sections', () => {
    const data: DigitalNativeData = {
      category: 'Digital-native B2C',
      confidence: 'High',
      reason: 'Sells consumer apps.',
      digital_criticality_signals: [],
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
      digital_criticality_signals: [],
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
      digital_criticality_signals: [],
      source_links: [],
    };
    expect(formatDigitalNativeForAttio(data)).not.toContain('Sources:');
  });

  it('appends a Signals block when digital_criticality_signals are present', () => {
    const data: DigitalNativeData = {
      category: 'Digitally critical B2C',
      confidence: 'High',
      reason: 'Legacy retailer with major e-commerce platform.',
      digital_criticality_signals: ['e-commerce', 'mobile app'],
      source_links: [],
    };
    expect(formatDigitalNativeForAttio(data)).toBe(
      'Digitally critical B2C\n\nConfidence: High\n\nReasoning: Legacy retailer with major e-commerce platform.\n\nSignals:\ne-commerce\nmobile app'
    );
  });

  it('renders Signals before Sources when both are present', () => {
    const data: DigitalNativeData = {
      category: 'Digitally critical B2B',
      confidence: 'Medium',
      reason: 'Traditional bank with business portals.',
      digital_criticality_signals: ['customer portal', 'API platform'],
      source_links: ['https://bank.com/about'],
    };
    const result = formatDigitalNativeForAttio(data);
    expect(result).toBe(
      'Digitally critical B2B\n\nConfidence: Medium\n\nReasoning: Traditional bank with business portals.\n\nSignals:\ncustomer portal\nAPI platform\n\nSources:\nhttps://bank.com/about'
    );
    expect(result.indexOf('Signals:')).toBeLessThan(result.indexOf('Sources:'));
  });

  it('omits the Signals block when digital_criticality_signals is empty', () => {
    const data: DigitalNativeData = {
      category: 'Digital-native B2C',
      confidence: 'High',
      reason: 'Born digital.',
      digital_criticality_signals: [],
      source_links: [],
    };
    expect(formatDigitalNativeForAttio(data)).not.toContain('Signals:');
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

  it('passes a Digitally critical B2C cached value', () => {
    expect(
      digitalNativeCacheGate('Digitally critical B2C\n\nConfidence: High\n\nReasoning: x')
    ).toBe(true);
  });

  it('passes a Digitally critical B2B cached value', () => {
    expect(
      digitalNativeCacheGate('Digitally critical B2B\n\nConfidence: High\n\nReasoning: x')
    ).toBe(true);
  });

  it('rejects a NOT Digital-native or digitally critical cached value', () => {
    expect(
      digitalNativeCacheGate('NOT Digital-native or digitally critical\n\nConfidence: High\n\nReasoning: x')
    ).toBe(false);
  });

  it('rejects a legacy NOT Digital-native cached value', () => {
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

  it('returns Digitally critical B2B', () => {
    expect(getDigitalNativeCategoryFromCached('Digitally critical B2B\n\nConfidence: High\n\nReasoning: ...')).toBe('Digitally critical B2B');
  });

  it('returns Digitally critical B2C', () => {
    expect(getDigitalNativeCategoryFromCached('Digitally critical B2C\n\nConfidence: High\n\nReasoning: ...')).toBe('Digitally critical B2C');
  });

  it('returns NOT Digital-native or digitally critical', () => {
    expect(getDigitalNativeCategoryFromCached('NOT Digital-native or digitally critical\n\nConfidence: High\n\nReasoning: ...')).toBe('NOT Digital-native or digitally critical');
  });

  it('returns legacy NOT Digital-native string (backwards compat)', () => {
    expect(getDigitalNativeCategoryFromCached('NOT Digital-native\n\nConfidence: High\n\nReasoning: ...')).toBe('NOT Digital-native');
  });

  it('returns null for an unrecognised first line', () => {
    expect(getDigitalNativeCategoryFromCached('Some random text')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(getDigitalNativeCategoryFromCached('')).toBeNull();
  });
});
