import { describe, it, expect } from 'vitest';
import {
  parseDigitalNativeResponse,
  digitalNativeGate,
  formatDigitalNativeForAttio,
  type DigitalNativeData,
} from './digitalNative.js';
import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany } from './types.js';

function buildResponse(content: string): ExaSearchResponse {
  return {
    results: [],
    searchTime: 0,
    output: { content, grounding: [] },
    costDollars: { total: 0 },
  };
}

describe('parseDigitalNativeResponse', () => {
  it('parses a single well-formed block for a single company', () => {
    const raw = buildResponse(
      'acme.com\nCATEGORY: Digital-native B2C\nCONFIDENCE: High\nREASON: Sells consumer apps.'
    );
    const companies: StageCompany[] = [{ companyName: 'Acme', domain: 'acme.com' }];
    const out = parseDigitalNativeResponse(raw, companies);
    expect(out).toHaveLength(1);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data).toEqual({
      category: 'Digital-native B2C',
      confidence: 'High',
      reason: 'Sells consumer apps.',
    });
  });

  it('parses multiple blocks separated by blank lines', () => {
    const raw = buildResponse(
      [
        'acme.com',
        'CATEGORY: Digital-native B2C',
        'CONFIDENCE: High',
        'REASON: Consumer app.',
        '',
        'beta.io',
        'CATEGORY: Digital-native B2B',
        'CONFIDENCE: Medium',
        'REASON: SaaS for businesses.',
      ].join('\n')
    );
    const companies: StageCompany[] = [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ];
    const out = parseDigitalNativeResponse(raw, companies);
    expect(out[0]!.data?.category).toBe('Digital-native B2C');
    expect(out[1]!.data?.category).toBe('Digital-native B2B');
  });

  it('strips a leading www. from the domain line when matching', () => {
    const raw = buildResponse(
      'www.acme.com\nCATEGORY: Digital-native B2C\nCONFIDENCE: High\nREASON: ok.'
    );
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
    ]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases the parsed domain when matching', () => {
    const raw = buildResponse(
      'ACME.com\nCATEGORY: Digital-native B2C\nCONFIDENCE: High\nREASON: ok.'
    );
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
    ]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('returns "no output from Exa" when a company is not present in the response', () => {
    const raw = buildResponse('acme.com\nCATEGORY: Digital-native B2C\nCONFIDENCE: High\nREASON: ok.');
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Missing', domain: 'missing.com' },
    ]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('skips malformed blocks (missing required fields)', () => {
    const raw = buildResponse(
      [
        'acme.com',
        'CATEGORY: Digital-native B2C',
        'CONFIDENCE: High',
        // no REASON — block should be skipped
        '',
        'beta.io',
        'CATEGORY: Digital-native B2B',
        'CONFIDENCE: High',
        'REASON: valid.',
      ].join('\n')
    );
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ]);
    expect(out[0]!.error).toBe('no output from Exa');
    expect(out[1]!.data?.category).toBe('Digital-native B2B');
  });

  it('captures REASON content up to the next UPPERCASE FIELD line', () => {
    const raw = buildResponse(
      [
        'acme.com',
        'CATEGORY: Digital-native B2C',
        'CONFIDENCE: High',
        'REASON: Actual reason here.',
        'CITATIONS: https://example.com',
      ].join('\n')
    );
    const out = parseDigitalNativeResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
    ]);
    expect(out[0]!.data?.reason).toBe('Actual reason here.');
  });
});

describe('digitalNativeGate', () => {
  it('rejects NOT Digital-native', () => {
    expect(
      digitalNativeGate({ category: 'NOT Digital-native', confidence: 'High', reason: 'x' })
    ).toBe(false);
  });

  it('rejects Digital-native B2B', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2B', confidence: 'High', reason: 'x' })
    ).toBe(false);
  });

  it('accepts Digital-native B2C', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2C', confidence: 'High', reason: 'x' })
    ).toBe(true);
  });

  it('accepts Digital-native B2B2C', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2B2C', confidence: 'High', reason: 'x' })
    ).toBe(true);
  });

  it('accepts Digital-native B2C2B', () => {
    expect(
      digitalNativeGate({ category: 'Digital-native B2C2B', confidence: 'High', reason: 'x' })
    ).toBe(true);
  });
});

describe('formatDigitalNativeForAttio', () => {
  it('renders the documented multi-line Attio value format', () => {
    const data: DigitalNativeData = {
      category: 'Digital-native B2C',
      confidence: 'High',
      reason: 'Sells consumer apps.',
    };
    expect(formatDigitalNativeForAttio(data)).toBe(
      'Digital-native B2C\nConfidence: High\nReasoning: Sells consumer apps.'
    );
  });
});
