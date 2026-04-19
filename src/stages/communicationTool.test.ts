import { describe, it, expect } from 'vitest';
import {
  parseCommunicationToolResponse,
  communicationToolGate,
  formatCommunicationToolForAttio,
  type CommunicationToolRaw,
} from './communicationTool.js';
import type { StageCompany } from './types.js';

const company: StageCompany = { companyName: 'Acme', domain: 'acme.com' };

describe('parseCommunicationToolResponse', () => {
  it('returns one result per batchSize-1 call', () => {
    const raw: CommunicationToolRaw = { domain: 'acme.com', tool: 'Slack', sourceUrl: 'https://example.com' };
    const results = parseCommunicationToolResponse(raw, [company]);
    expect(results).toHaveLength(1);
    expect(results[0]?.company.domain).toBe('acme.com');
  });

  it('returns empty array when companies is empty', () => {
    const raw: CommunicationToolRaw = { domain: 'acme.com', tool: null, sourceUrl: null };
    expect(parseCommunicationToolResponse(raw, [])).toHaveLength(0);
  });
});

describe('communicationToolGate', () => {
  it('passes when Slack is found', () => {
    expect(communicationToolGate({ tool: 'Slack', sourceUrl: 'https://example.com' })).toBe(true);
  });

  it('rejects when Microsoft Teams is found', () => {
    expect(communicationToolGate({ tool: 'Microsoft Teams', sourceUrl: 'https://example.com' })).toBe(false);
  });

  it('passes when no evidence', () => {
    expect(communicationToolGate({ tool: null, sourceUrl: null })).toBe(true);
  });
});

describe('formatCommunicationToolForAttio', () => {
  it('formats Slack with source URL', () => {
    expect(formatCommunicationToolForAttio({ tool: 'Slack', sourceUrl: 'https://jobs.lever.co/acme' }))
      .toBe('Slack: https://jobs.lever.co/acme');
  });

  it('formats Microsoft Teams with source URL', () => {
    expect(formatCommunicationToolForAttio({ tool: 'Microsoft Teams', sourceUrl: 'https://linkedin.com/jobs/123' }))
      .toBe('Microsoft Teams: https://linkedin.com/jobs/123');
  });

  it('formats no-evidence as literal string', () => {
    expect(formatCommunicationToolForAttio({ tool: null, sourceUrl: null })).toBe('No evidence found');
  });
});
