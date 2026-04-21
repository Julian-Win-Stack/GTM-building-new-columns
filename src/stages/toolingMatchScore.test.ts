import { describe, it, expect } from 'vitest';
import { formatToolingMatchScoreForAttio, parseToolingMatchResponse } from './toolingMatchScore.js';
import { FIELD_SLUGS } from '../apis/attio.js';

describe('parseToolingMatchResponse', () => {
  it('maps raw response to camelCase and computes final score', () => {
    const raw = {
      communication_tool_score: 5,
      competitor_tooling_score: 3,
      observability_tool_score: 4,
      cloud_tool_score: 5,
      justification: {
        communication_tool: 'Slack confirmed',
        competitor_tooling: 'incident.io confirmed',
        observability_tool: 'Datadog + Grafana confirmed',
        cloud_tool: 'AWS confirmed',
      },
    };
    const result = parseToolingMatchResponse(raw);
    expect(result.communicationToolScore).toBe(5);
    expect(result.competitorToolingScore).toBe(3);
    expect(result.observabilityToolScore).toBe(4);
    expect(result.cloudToolScore).toBe(5);
    expect(result.finalToolScore).toBe(4.25);
    expect(result.justification.communicationTool).toBe('Slack confirmed');
    expect(result.justification.competitorTooling).toBe('incident.io confirmed');
    expect(result.justification.observabilityTool).toBe('Datadog + Grafana confirmed');
    expect(result.justification.cloudTool).toBe('AWS confirmed');
  });

  it('computes correct final score for minimum inputs', () => {
    const raw = {
      communication_tool_score: 0,
      competitor_tooling_score: 1,
      observability_tool_score: 1,
      cloud_tool_score: 4,
      justification: { communication_tool: '', competitor_tooling: '', observability_tool: '', cloud_tool: '' },
    };
    const result = parseToolingMatchResponse(raw);
    expect(result.finalToolScore).toBe(1.5); // (0+1+1+4)/4
  });

  it('computes correct final score for maximum inputs', () => {
    const raw = {
      communication_tool_score: 5,
      competitor_tooling_score: 5,
      observability_tool_score: 5,
      cloud_tool_score: 5,
      justification: { communication_tool: '', competitor_tooling: '', observability_tool: '', cloud_tool: '' },
    };
    const result = parseToolingMatchResponse(raw);
    expect(result.finalToolScore).toBe(5);
  });

  it('throws on invalid communication_tool_score', () => {
    const raw = {
      communication_tool_score: 2,
      competitor_tooling_score: 3,
      observability_tool_score: 4,
      cloud_tool_score: 5,
      justification: { communication_tool: '', competitor_tooling: '', observability_tool: '', cloud_tool: '' },
    };
    expect(() => parseToolingMatchResponse(raw)).toThrow('communication_tool_score');
  });

  it('throws on invalid competitor_tooling_score', () => {
    const raw = {
      communication_tool_score: 5,
      competitor_tooling_score: 2,
      observability_tool_score: 4,
      cloud_tool_score: 5,
      justification: { communication_tool: '', competitor_tooling: '', observability_tool: '', cloud_tool: '' },
    };
    expect(() => parseToolingMatchResponse(raw)).toThrow('competitor_tooling_score');
  });

  it('throws on invalid observability_tool_score', () => {
    const raw = {
      communication_tool_score: 5,
      competitor_tooling_score: 3,
      observability_tool_score: 2,
      cloud_tool_score: 5,
      justification: { communication_tool: '', competitor_tooling: '', observability_tool: '', cloud_tool: '' },
    };
    expect(() => parseToolingMatchResponse(raw)).toThrow('observability_tool_score');
  });

  it('throws on invalid cloud_tool_score', () => {
    const raw = {
      communication_tool_score: 5,
      competitor_tooling_score: 3,
      observability_tool_score: 4,
      cloud_tool_score: 3,
      justification: { communication_tool: '', competitor_tooling: '', observability_tool: '', cloud_tool: '' },
    };
    expect(() => parseToolingMatchResponse(raw)).toThrow('cloud_tool_score');
  });
});

describe('formatToolingMatchScoreForAttio', () => {
  it('produces the expected multi-line block', () => {
    const data = {
      communicationToolScore: 5 as const,
      competitorToolingScore: 3 as const,
      observabilityToolScore: 4 as const,
      cloudToolScore: 5 as const,
      finalToolScore: 4.25,
      justification: {
        communicationTool: 'Slack confirmed',
        competitorTooling: 'incident.io confirmed',
        observabilityTool: 'Datadog + Grafana confirmed',
        cloudTool: 'AWS confirmed',
      },
    };
    expect(formatToolingMatchScoreForAttio(data)).toBe(
      'Final Tool Score: 4.25\n' +
      'Communication Tool Score: 5\n' +
      'Competitor Tooling Score: 3\n' +
      'Observability Tool Score: 4\n' +
      'Cloud Tool Score: 5\n' +
      '\n' +
      'Justification:\n' +
      '- Communication Tool: Slack confirmed\n' +
      '- Competitor Tooling: incident.io confirmed\n' +
      '- Observability Tool: Datadog + Grafana confirmed\n' +
      '- Cloud Tool: AWS confirmed'
    );
  });

  it('preserves "Not publicly confirmed" in justification lines', () => {
    const data = {
      communicationToolScore: 3 as const,
      competitorToolingScore: 5 as const,
      observabilityToolScore: 3 as const,
      cloudToolScore: 4 as const,
      finalToolScore: 3.75,
      justification: {
        communicationTool: 'Not publicly confirmed',
        competitorTooling: 'No competitor tools detected',
        observabilityTool: 'Not publicly confirmed',
        cloudTool: 'Not publicly confirmed',
      },
    };
    const result = formatToolingMatchScoreForAttio(data);
    expect(result).toContain('- Communication Tool: Not publicly confirmed');
    expect(result).toContain('- Observability Tool: Not publicly confirmed');
    expect(result).toContain('- Cloud Tool: Not publicly confirmed');
  });
});

describe('FIELD_SLUGS coverage', () => {
  it('has truthy slug for Tooling Match Score', () => {
    expect(FIELD_SLUGS['Tooling Match Score']).toBeTruthy();
  });

  it('has truthy slug for Tooling Match Change Detection for Developer', () => {
    expect(FIELD_SLUGS['Tooling Match Change Detection for Developer']).toBeTruthy();
  });
});
