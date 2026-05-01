import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../apis/openai.js', () => ({
  judge: vi.fn(),
  AZURE_DEPLOYMENT_DEFAULT: 'gpt-5.4',
  AZURE_DEPLOYMENT_PRO: 'gpt-5.4-pro',
}));
vi.mock('../rateLimit.js', () => ({
  openaiLimit: (fn: () => unknown) => fn(),
}));
vi.mock('../util.js', () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

import { judge } from '../apis/openai.js';
import {
  extractScoreFromContextCell,
  extractScoreFromToolingCell,
  extractScoreFromIntentCell,
  computeFinalScore,
  formatFinalScoreForAttio,
  scoreFinal,
  type FinalScoreData,
} from './finalScore.js';

const mockJudge = vi.mocked(judge);

// ---------------------------------------------------------------------------
// extractScoreFromContextCell
// ---------------------------------------------------------------------------
describe('extractScoreFromContextCell', () => {
  it('parses a float from the first line', () => {
    expect(extractScoreFromContextCell('4.5\n\nReasoning: High-scale platform.')).toBe(4.5);
  });

  it('parses an integer', () => {
    expect(extractScoreFromContextCell('3\n\nReasoning: Moderate fit.')).toBe(3);
  });

  it('parses zero', () => {
    expect(extractScoreFromContextCell('0\n\nReasoning: No digital surface.')).toBe(0);
  });

  it('returns null on empty string', () => {
    expect(extractScoreFromContextCell('')).toBeNull();
  });

  it('returns null when first token is not numeric', () => {
    expect(extractScoreFromContextCell('Reasoning: something')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractScoreFromToolingCell
// ---------------------------------------------------------------------------
describe('extractScoreFromToolingCell', () => {
  it('parses a float from "Final Tool Score:" line', () => {
    expect(extractScoreFromToolingCell('Final Tool Score: 4.25\nCommunication Tool Score: 5')).toBe(4.25);
  });

  it('parses an integer', () => {
    expect(extractScoreFromToolingCell('Final Tool Score: 5\nCommunication Tool Score: 5')).toBe(5);
  });

  it('returns null when marker is absent', () => {
    expect(extractScoreFromToolingCell('Communication Tool Score: 5\nCompetitor Tooling Score: 3')).toBeNull();
  });

  it('returns null on empty string', () => {
    expect(extractScoreFromToolingCell('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractScoreFromIntentCell
// ---------------------------------------------------------------------------
describe('extractScoreFromIntentCell', () => {
  it('parses a float from "Intent Signal Score:" line', () => {
    expect(extractScoreFromIntentCell('Intent Signal Score: 3.5\n\nReasoning:\nModerate intent.')).toBe(3.5);
  });

  it('parses zero', () => {
    expect(extractScoreFromIntentCell('Intent Signal Score: 0\n\nReasoning:\nNo signal.')).toBe(0);
  });

  it('returns null when marker is absent', () => {
    expect(extractScoreFromIntentCell('Reasoning:\nSomething else entirely')).toBeNull();
  });

  it('returns null on empty string', () => {
    expect(extractScoreFromIntentCell('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeFinalScore
// ---------------------------------------------------------------------------
describe('computeFinalScore', () => {
  it('applies hard override when context is 0', () => {
    expect(computeFinalScore({ context: 0, tooling: 5, intent: 5 })).toEqual({ finalScore: 0, tier: 5 });
  });

  it('override ignores tooling and intent scores', () => {
    expect(computeFinalScore({ context: 0, tooling: 0, intent: 0 })).toEqual({ finalScore: 0, tier: 5 });
  });

  it('computes the user example: context=4.5, tooling=4.0, intent=5.0 → 4.7, Tier 1', () => {
    expect(computeFinalScore({ context: 4.5, tooling: 4.0, intent: 5.0 })).toEqual({ finalScore: 4.7, tier: 1 });
  });

  it('Tier 1 boundary — exactly 4.5', () => {
    // 0.5*5 + 0.3*5 + 0.2*2.5 = 2.5+1.5+0.5 = 4.5
    expect(computeFinalScore({ context: 5, tooling: 2.5, intent: 5 })).toMatchObject({ tier: 1 });
  });

  it('Tier 2 — score between 3.5 and 4.4', () => {
    // 0.5*4 + 0.3*4 + 0.2*4 = 2+1.2+0.8 = 4.0
    expect(computeFinalScore({ context: 4, tooling: 4, intent: 4 })).toEqual({ finalScore: 4.0, tier: 2 });
  });

  it('Tier 2 boundary — exactly 3.5', () => {
    // 0.5*3 + 0.3*4 + 0.2*4 = 1.5+1.2+0.8 = 3.5
    expect(computeFinalScore({ context: 4, tooling: 4, intent: 3 })).toMatchObject({ tier: 2 });
  });

  it('Tier 3 — score between 2.5 and 3.4', () => {
    // 0.5*2 + 0.3*3 + 0.2*4 = 1+0.9+0.8 = 2.7
    expect(computeFinalScore({ context: 3, tooling: 4, intent: 2 })).toMatchObject({ tier: 3 });
  });

  it('Tier 4 — score between 1.5 and 2.4', () => {
    // 0.5*1.5 + 0.3*2 + 0.2*2 = 0.75+0.6+0.4 = 1.75
    expect(computeFinalScore({ context: 2, tooling: 2, intent: 1.5 })).toMatchObject({ tier: 4 });
  });

  it('Tier 5 — score below 1.5', () => {
    // 0.5*1 + 0.3*1 + 0.2*1 = 0.5+0.3+0.2 = 1.0
    expect(computeFinalScore({ context: 1, tooling: 1, intent: 1 })).toMatchObject({ tier: 5 });
  });

  it('rounds to 1 decimal place', () => {
    // 0.5*2.5 + 0.3*2.5 + 0.2*2.5 = 1.25+0.75+0.5 = 2.5
    const result = computeFinalScore({ context: 2.5, tooling: 2.5, intent: 2.5 });
    expect(result.finalScore).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// formatFinalScoreForAttio
// ---------------------------------------------------------------------------
describe('formatFinalScoreForAttio', () => {
  it('produces the expected three-block format', () => {
    const d: FinalScoreData = { finalScore: 4.7, tier: 1, reasoning: 'Strong fit with clear intent.' };
    expect(formatFinalScoreForAttio(d)).toBe(
      'Final Score: 4.7\nTier: Tier 1\n\nReasoning:\nStrong fit with clear intent.'
    );
  });

  it('includes tier number in the Tier line', () => {
    const d: FinalScoreData = { finalScore: 0, tier: 5, reasoning: 'No digital surface.' };
    expect(formatFinalScoreForAttio(d)).toContain('Tier: Tier 5');
  });
});

// ---------------------------------------------------------------------------
// scoreFinal
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockJudge.mockReset();
});

const COMPANY = { companyName: 'Acme', domain: 'acme.com', linkedinUrl: '' };

const VALUES_VALID = {
  company_context_score: '4.5\n\nReasoning: High-scale platform.',
  tooling_match_score: 'Final Tool Score: 4\nCommunication Tool Score: 5',
  intent_signal_score: 'Intent Signal Score: 5\n\nReasoning:\nStrong signals.',
};

describe('scoreFinal', () => {
  it('calls judge with the non-pro deployment model', async () => {
    mockJudge.mockResolvedValue({ reasoning: 'Strong overall fit.' });
    await scoreFinal(COMPANY, VALUES_VALID);
    expect(mockJudge).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.4' })
    );
  });

  it('passes the computed score and tier in the user prompt', async () => {
    mockJudge.mockResolvedValue({ reasoning: 'Strong overall fit.' });
    await scoreFinal(COMPANY, VALUES_VALID);
    const callArgs = mockJudge.mock.calls[0]![0] as { user: string };
    expect(callArgs.user).toContain('Computed Final Score:');
    expect(callArgs.user).toContain('(Tier');
  });

  it('uses final_score_reasoning schema', async () => {
    mockJudge.mockResolvedValue({ reasoning: 'Strong overall fit.' });
    await scoreFinal(COMPANY, VALUES_VALID);
    const callArgs = mockJudge.mock.calls[0]![0] as { schema: { name: string } };
    expect(callArgs.schema.name).toBe('final_score_reasoning');
  });

  it('returns computed score and reasoning from judge', async () => {
    mockJudge.mockResolvedValue({ reasoning: 'Excellent signals.' });
    // context=4.5, tooling=4, intent=5 → 0.5*5 + 0.3*4.5 + 0.2*4 = 2.5+1.35+0.8 = 4.65 → 4.7
    const result = await scoreFinal(COMPANY, VALUES_VALID);
    expect(result.finalScore).toBe(4.7);
    expect(result.tier).toBe(1);
    expect(result.reasoning).toBe('Excellent signals.');
  });

  it('hard-override path: context=0 skips judge call and returns canned reasoning', async () => {
    const overrideValues = {
      company_context_score: '0\n\nReasoning: No digital surface.',
      tooling_match_score: 'Final Tool Score: 5\nCommunication Tool Score: 5',
      intent_signal_score: 'Intent Signal Score: 5\n\nReasoning:\nStrong signals.',
    };
    const result = await scoreFinal(COMPANY, overrideValues);
    expect(mockJudge).not.toHaveBeenCalled();
    expect(result.finalScore).toBe(0);
    expect(result.tier).toBe(5);
    expect(result.reasoning).toContain('override');
  });

  it('throws when a score cell cannot be parsed', async () => {
    const badValues = {
      company_context_score: 'malformed cell',
      tooling_match_score: 'Final Tool Score: 4',
      intent_signal_score: 'Intent Signal Score: 3',
    };
    await expect(scoreFinal(COMPANY, badValues)).rejects.toThrow('failed to parse input scores');
  });
});
