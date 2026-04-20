import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatCustomerComplaintsForAttio, parseCustomerComplaintsResponse } from './customerComplaintsOnX.js';
import type { StageCompany } from './types.js';

vi.mock('../apis/openai.js', () => ({
  judge: vi.fn(),
}));

vi.mock('../rateLimit.js', () => ({
  openaiLimit: (fn: () => unknown) => fn(),
}));

vi.mock('../util.js', () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

import { judge } from '../apis/openai.js';

const company: StageCompany = { companyName: 'Acme', domain: 'acme.com' };

describe('formatCustomerComplaintsForAttio', () => {
  it('formats all-zero counts', () => {
    expect(
      formatCustomerComplaintsForAttio({ full_outage: 0, partial_outage: 0, performance_degradation: 0, unclear: 0 })
    ).toBe('Full outage: 0\nPartial outage: 0\nPerformance degradation: 0\nUnclear: 0');
  });

  it('formats mixed counts', () => {
    expect(
      formatCustomerComplaintsForAttio({ full_outage: 3, partial_outage: 10, performance_degradation: 5, unclear: 7 })
    ).toBe('Full outage: 3\nPartial outage: 10\nPerformance degradation: 5\nUnclear: 7');
  });
});

describe('parseCustomerComplaintsResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when companies array is empty', async () => {
    const results = await parseCustomerComplaintsResponse(['tweet'], []);
    expect(results).toHaveLength(0);
  });

  it('returns all-zeros without calling OpenAI when tweet array is empty', async () => {
    const results = await parseCustomerComplaintsResponse([], [company]);
    expect(results).toHaveLength(1);
    expect(results[0]!.data).toEqual({ full_outage: 0, partial_outage: 0, performance_degradation: 0, unclear: 0 });
    expect(judge).not.toHaveBeenCalled();
  });

  it('calls judge and returns classified counts for non-empty tweets', async () => {
    vi.mocked(judge).mockResolvedValue({
      full_outage: 2,
      partial_outage: 5,
      performance_degradation: 1,
      unclear: 3,
    });

    const tweets = ['service is down', 'cant access dashboard'];
    const results = await parseCustomerComplaintsResponse(tweets, [company]);

    expect(results).toHaveLength(1);
    expect(results[0]!.data).toEqual({ full_outage: 2, partial_outage: 5, performance_degradation: 1, unclear: 3 });
    expect(judge).toHaveBeenCalledOnce();
  });

  it('passes company name into the prompt', async () => {
    vi.mocked(judge).mockResolvedValue({ full_outage: 0, partial_outage: 0, performance_degradation: 0, unclear: 1 });

    await parseCustomerComplaintsResponse(['some tweet'], [company]);

    const call = vi.mocked(judge).mock.calls[0]![0];
    expect(call.user).toContain('Acme');
  });
});
