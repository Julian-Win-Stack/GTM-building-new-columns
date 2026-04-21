import { describe, it, expect } from 'vitest';
import {
  parseIntentSignalResponse,
  formatIntentSignalScoreForAttio,
  INTENT_SIGNAL_INPUT_COLUMNS,
  type IntentSignalScoreData,
} from './intentSignalScore.js';

describe('INTENT_SIGNAL_INPUT_COLUMNS', () => {
  it('has 8 columns', () => {
    expect(INTENT_SIGNAL_INPUT_COLUMNS).toHaveLength(8);
  });

  it('starts with Tier 1 columns', () => {
    expect(INTENT_SIGNAL_INPUT_COLUMNS[0]).toBe('Customer complains on X');
    expect(INTENT_SIGNAL_INPUT_COLUMNS[1]).toBe('Engineer Hiring');
    expect(INTENT_SIGNAL_INPUT_COLUMNS[2]).toBe('SRE Hiring');
    expect(INTENT_SIGNAL_INPUT_COLUMNS[3]).toBe('AI SRE maturity');
  });

  it('includes Tier 2 columns', () => {
    expect(INTENT_SIGNAL_INPUT_COLUMNS[4]).toBe('Recent incidents ( Official )');
    expect(INTENT_SIGNAL_INPUT_COLUMNS[5]).toBe('AI adoption mindset');
  });

  it('includes Tier 3 columns', () => {
    expect(INTENT_SIGNAL_INPUT_COLUMNS[6]).toBe('Funding Growth');
    expect(INTENT_SIGNAL_INPUT_COLUMNS[7]).toBe('Revenue Growth');
  });
});

describe('parseIntentSignalResponse', () => {
  it('accepts all valid 0.5-increment scores', () => {
    const validScores = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    for (const score of validScores) {
      const result = parseIntentSignalResponse({ score, reasoning: 'test' }, 'acme.com');
      expect(result.score).toBe(score);
      expect(result.reasoning).toBe('test');
    }
  });

  it('throws for a score outside the allowed set', () => {
    expect(() => parseIntentSignalResponse({ score: 2.7, reasoning: 'r' }, 'acme.com'))
      .toThrow('intentSignal: invalid score "2.7" for acme.com');
  });

  it('throws for a score above 5', () => {
    expect(() => parseIntentSignalResponse({ score: 6, reasoning: 'r' }, 'acme.com'))
      .toThrow('intentSignal: invalid score "6" for acme.com');
  });

  it('throws for a negative score', () => {
    expect(() => parseIntentSignalResponse({ score: -1, reasoning: 'r' }, 'acme.com'))
      .toThrow('intentSignal: invalid score "-1" for acme.com');
  });
});

describe('formatIntentSignalScoreForAttio', () => {
  it('formats with score prefix and reasoning block', () => {
    const d: IntentSignalScoreData = { score: 3.5, reasoning: 'Strong SRE hiring signal.' };
    const result = formatIntentSignalScoreForAttio(d);
    expect(result).toBe('Intent Signal Score: 3.5\n\nReasoning:\nStrong SRE hiring signal.');
  });

  it('formats score of 0 correctly', () => {
    const d: IntentSignalScoreData = { score: 0, reasoning: 'No public data available.' };
    const result = formatIntentSignalScoreForAttio(d);
    expect(result).toBe('Intent Signal Score: 0\n\nReasoning:\nNo public data available.');
  });

  it('formats score of 5 correctly', () => {
    const d: IntentSignalScoreData = { score: 5, reasoning: 'All signals very strong.' };
    const result = formatIntentSignalScoreForAttio(d);
    expect(result).toBe('Intent Signal Score: 5\n\nReasoning:\nAll signals very strong.');
  });
});
