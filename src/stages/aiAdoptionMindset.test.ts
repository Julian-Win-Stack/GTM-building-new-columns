import { describe, it, expect } from 'vitest';
import { parseAiAdoptionMindsetResponse, formatAiAdoptionMindsetForAttio } from './aiAdoptionMindset.js';
import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany } from './types.js';

const company: StageCompany = { companyName: 'Acme', domain: 'acme.com' };

function makeRaw(content: unknown): ExaSearchResponse {
  return {
    results: [],
    searchTime: 0,
    output: { content: content as string | Record<string, unknown>, grounding: [] },
    costDollars: { total: 0 },
  };
}

describe('parseAiAdoptionMindsetResponse', () => {
  it('returns data when output.content is a non-empty string', () => {
    const text = 'Classification: Aggressive\nConfidence: High\nEvidence:\n- "example" (https://example.com)';
    const results = parseAiAdoptionMindsetResponse(makeRaw(text), [company]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ company, data: { text } });
  });

  it('returns error when output.content is an empty string', () => {
    const results = parseAiAdoptionMindsetResponse(makeRaw('   '), [company]);
    expect(results[0]).toMatchObject({ company, error: 'no output from Exa' });
  });

  it('returns error when output.content is an object (not text)', () => {
    const results = parseAiAdoptionMindsetResponse(makeRaw({ companies: [] }), [company]);
    expect(results[0]).toMatchObject({ company, error: 'no output from Exa' });
  });

  it('returns error when output is undefined', () => {
    const raw = { results: [], searchTime: 0, output: undefined as unknown as ExaSearchResponse['output'], costDollars: { total: 0 } };
    const results = parseAiAdoptionMindsetResponse(raw, [company]);
    expect(results[0]).toMatchObject({ company, error: 'no output from Exa' });
  });

  it('trims leading/trailing whitespace from text', () => {
    const results = parseAiAdoptionMindsetResponse(makeRaw('  hello  '), [company]);
    expect(results[0]).toMatchObject({ company, data: { text: 'hello' } });
  });
});

describe('formatAiAdoptionMindsetForAttio', () => {
  it('passes text through unchanged', () => {
    const text = 'Classification: Neutral\nConfidence: Low';
    expect(formatAiAdoptionMindsetForAttio({ text })).toBe(text);
  });
});
