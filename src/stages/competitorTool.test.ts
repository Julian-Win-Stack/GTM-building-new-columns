import { describe, it, expect } from 'vitest';
import {
  matchCompetitorTools,
  competitorToolGate,
  formatCompetitorToolForAttio,
} from './competitorTool.js';

describe('matchCompetitorTools', () => {
  it('returns one tool for a single-tool match', () => {
    expect(matchCompetitorTools('Rootly')).toEqual([]);
    expect(matchCompetitorTools('Webflow')).toEqual(['Rootly']);
    expect(matchCompetitorTools('Netflix')).toEqual(['Incident.io']);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(matchCompetitorTools('  netflix  ')).toEqual(['Incident.io']);
    expect(matchCompetitorTools('ZOOM')).toEqual(['PagerDuty']);
    expect(matchCompetitorTools('DoorDash')).toEqual(['Resolve.ai']);
  });

  it('returns multiple tools when a company appears in several', () => {
    expect(matchCompetitorTools('Cisco')).toEqual(['Splunk On-Call', 'BigPanda']);
    expect(matchCompetitorTools('Yahoo')).toEqual(['Opsgenie', 'Moogsoft']);
    expect(matchCompetitorTools('American Airlines')).toEqual(['xMatters', 'Moogsoft']);
    expect(matchCompetitorTools('Intuit')).toEqual(['Splunk On-Call', 'Moogsoft']);
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

  it('formats single match as tool name', () => {
    expect(formatCompetitorToolForAttio({ matchedTools: ['Rootly'] })).toBe('Rootly');
  });

  it('formats multiple matches joined by comma', () => {
    expect(
      formatCompetitorToolForAttio({ matchedTools: ['Splunk On-Call', 'BigPanda'] })
    ).toBe('Splunk On-Call, BigPanda');
  });
});
