import { describe, it, expect } from 'vitest';
import {
  matchCompetitorTools,
  detectCompetitorToolsFromTheirStack,
  formatCompetitorToolForAttio,
} from './competitorTool.js';

describe('matchCompetitorTools', () => {
  it('returns the matched tool with customer_page evidence', () => {
    const result = matchCompetitorTools('Webflow');
    expect(result.matchedTools).toEqual(['Rootly']);
    expect(result.evidence['Rootly']).toEqual({ type: 'customer_page' });
  });

  it('returns correct tool for Incident.io customer', () => {
    const result = matchCompetitorTools('Netflix');
    expect(result.matchedTools).toEqual(['Incident.io']);
    expect(result.evidence['Incident.io']).toEqual({ type: 'customer_page' });
  });

  it('returns correct tool for Resolve.ai customer', () => {
    const result = matchCompetitorTools('DoorDash');
    expect(result.matchedTools).toEqual(['Resolve.ai']);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(matchCompetitorTools('  netflix  ').matchedTools).toEqual(['Incident.io']);
    expect(matchCompetitorTools('webflow').matchedTools).toEqual(['Rootly']);
  });

  it('returns empty for unknown companies', () => {
    expect(matchCompetitorTools('Acme Inc.').matchedTools).toEqual([]);
    expect(matchCompetitorTools('').matchedTools).toEqual([]);
    expect(matchCompetitorTools(undefined).matchedTools).toEqual([]);
  });
});

describe('detectCompetitorToolsFromTheirStack', () => {
  it('detects via technology_slugs', () => {
    expect(detectCompetitorToolsFromTheirStack({ technology_slugs: ['komodor'] })).toEqual(['Komodor']);
    expect(detectCompetitorToolsFromTheirStack({ technology_slugs: ['mezmo'] })).toEqual(['Mezmo']);
    expect(detectCompetitorToolsFromTheirStack({ technology_slugs: ['rootly-slack'] })).toEqual(['Rootly']);
  });

  it('detects via technology_names (case-insensitive)', () => {
    expect(detectCompetitorToolsFromTheirStack({ technology_names: ['Komodor'] })).toEqual(['Komodor']);
    expect(detectCompetitorToolsFromTheirStack({ technology_names: ['MEZMO'] })).toEqual(['Mezmo']);
    expect(detectCompetitorToolsFromTheirStack({ technology_names: ['rootly-slack'] })).toEqual(['Rootly']);
  });

  it('deduplicates when tool appears in both fields', () => {
    const result = detectCompetitorToolsFromTheirStack({
      technology_slugs: ['komodor'],
      technology_names: ['komodor'],
    });
    expect(result).toEqual(['Komodor']);
  });

  it('detects multiple tools from a single response', () => {
    const result = detectCompetitorToolsFromTheirStack({
      technology_slugs: ['komodor', 'mezmo'],
    });
    expect(result).toEqual(['Komodor', 'Mezmo']);
  });

  it('does not match on substring — exact equality required', () => {
    // "komodor-api" is not the same as "komodor"
    expect(detectCompetitorToolsFromTheirStack({ technology_slugs: ['komodor-api'] })).toEqual([]);
    expect(detectCompetitorToolsFromTheirStack({ technology_names: ['Rootly Slack'] })).toEqual([]);
  });

  it('returns empty when neither field contains a match', () => {
    expect(detectCompetitorToolsFromTheirStack({ technology_slugs: ['datadog'] })).toEqual([]);
    expect(detectCompetitorToolsFromTheirStack({})).toEqual([]);
  });
});

describe('formatCompetitorToolForAttio', () => {
  it('formats no-match as literal string', () => {
    expect(formatCompetitorToolForAttio({ matchedTools: [], evidence: {} })).toBe(
      'Not using any competitor tools'
    );
  });

  it('formats a hardcoded (customer_page) match', () => {
    expect(
      formatCompetitorToolForAttio({
        matchedTools: ['Rootly'],
        evidence: { 'Rootly': { type: 'customer_page' } },
      })
    ).toBe("Rootly\n\nEvidence: (Rootly's customer page)");
  });

  it('formats a TheirStack match with source URL', () => {
    expect(
      formatCompetitorToolForAttio({
        matchedTools: ['Komodor'],
        evidence: { 'Komodor': { type: 'theirstack', sourceUrl: 'https://example.com/jobs/123' } },
      })
    ).toBe('Komodor\n\nEvidence: https://example.com/jobs/123');
  });

  it('formats multiple matches with mixed evidence types', () => {
    const result = formatCompetitorToolForAttio({
      matchedTools: ['Rootly', 'Komodor'],
      evidence: {
        'Rootly': { type: 'customer_page' },
        'Komodor': { type: 'theirstack', sourceUrl: 'https://example.com/jobs/123' },
      },
    });
    expect(result).toBe(
      "Rootly, Komodor\n\nEvidence: (Rootly's customer page)\nEvidence: https://example.com/jobs/123"
    );
  });
});
