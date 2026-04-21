import { describe, it, expect } from 'vitest';
import {
  matchCompetitorTools,
  competitorToolGate,
  formatCompetitorToolForAttio,
  competitorToolCacheGate,
  extractMatchedToolsFromCached,
} from './competitorTool.js';

describe('matchCompetitorTools', () => {
  it('returns one tool for a single-tool match', () => {
    expect(matchCompetitorTools('Rootly')).toEqual([]);
    expect(matchCompetitorTools('Webflow')).toEqual(['Rootly']);
    expect(matchCompetitorTools('Netflix')).toEqual(['Incident.io']);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(matchCompetitorTools('  netflix  ')).toEqual(['Incident.io']);
    expect(matchCompetitorTools('webflow')).toEqual(['Rootly']);
    expect(matchCompetitorTools('DoorDash')).toEqual(['Resolve.ai']);
  });

  it('returns empty for unknown companies', () => {
    expect(matchCompetitorTools('Acme Inc.')).toEqual([]);
    expect(matchCompetitorTools('')).toEqual([]);
    expect(matchCompetitorTools(undefined)).toEqual([]);
  });
});

describe('competitorToolGate', () => {
  it('passes when no tools matched', () => {
    expect(competitorToolGate({ matchedTools: [] })).toBe(true);
  });

  it('rejects when at least one tool matched', () => {
    expect(competitorToolGate({ matchedTools: ['Rootly'] })).toBe(false);
    expect(competitorToolGate({ matchedTools: ['Rootly', 'Incident.io'] })).toBe(false);
  });
});

describe('formatCompetitorToolForAttio', () => {
  it('formats no-match as literal string', () => {
    expect(formatCompetitorToolForAttio({ matchedTools: [] })).toBe(
      'Not using any competitor tools'
    );
  });

  it('formats single match with evidence line', () => {
    expect(formatCompetitorToolForAttio({ matchedTools: ['Rootly'] })).toBe(
      "Rootly\n\nEvidence: (Rootly's customer page)"
    );
  });

  it('formats multiple matches with one evidence line per tool', () => {
    expect(
      formatCompetitorToolForAttio({ matchedTools: ['Resolve.ai', 'Rootly'] })
    ).toBe(
      "Resolve.ai, Rootly\n\nEvidence: (Resolve.ai's customer page)\nEvidence: (Rootly's customer page)"
    );
  });
});

describe('extractMatchedToolsFromCached', () => {
  it('returns empty for no-match sentinel', () => {
    expect(extractMatchedToolsFromCached('Not using any competitor tools')).toEqual([]);
  });

  it('extracts single tool from new multi-line format', () => {
    expect(
      extractMatchedToolsFromCached("Rootly\n\nEvidence: (Rootly's customer page)")
    ).toEqual(['Rootly']);
  });

  it('extracts multiple tools from new multi-line format', () => {
    expect(
      extractMatchedToolsFromCached(
        "Resolve.ai, Rootly\n\nEvidence: (Resolve.ai's customer page)\nEvidence: (Rootly's customer page)"
      )
    ).toEqual(['Resolve.ai', 'Rootly']);
  });

  it('is backward-compatible with legacy single-line format', () => {
    expect(extractMatchedToolsFromCached('Rootly')).toEqual(['Rootly']);
    expect(extractMatchedToolsFromCached('Resolve.ai, Rootly')).toEqual(['Resolve.ai', 'Rootly']);
  });

  it('returns empty for empty input', () => {
    expect(extractMatchedToolsFromCached('')).toEqual([]);
  });
});

describe('competitorToolCacheGate', () => {
  it('passes the "no match" sentinel', () => {
    expect(competitorToolCacheGate('Not using any competitor tools')).toBe(true);
  });

  it('passes with surrounding whitespace', () => {
    expect(competitorToolCacheGate('  Not using any competitor tools  ')).toBe(true);
  });

  it('rejects when a competitor tool is recorded', () => {
    expect(competitorToolCacheGate('Resolve.ai')).toBe(false);
    expect(competitorToolCacheGate('Rootly')).toBe(false);
    expect(competitorToolCacheGate('Incident.io')).toBe(false);
  });

  it('rejects empty cached value', () => {
    expect(competitorToolCacheGate('')).toBe(false);
  });
});
