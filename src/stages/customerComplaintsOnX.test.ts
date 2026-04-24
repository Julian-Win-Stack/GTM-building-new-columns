import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatCustomerComplaintsForAttio, parseCustomerComplaintsResponse } from './customerComplaintsOnX.js';
import type { StageCompany } from './types.js';
import type { TweetItem } from '../apis/twitterapi.js';

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

function makeTweets(texts: string[], baseUrl = 'https://x.com/i/status/'): TweetItem[] {
  return texts.map((text, i) => ({ text, url: `${baseUrl}${i + 1}` }));
}

describe('formatCustomerComplaintsForAttio', () => {
  it('formats all-zero counts with no URLs', () => {
    expect(
      formatCustomerComplaintsForAttio({ full_outage: 0, full_outage_urls: [], partial_outage: 0, partial_outage_urls: [], performance_degradation: 0, performance_degradation_urls: [], unclear: 0 })
    ).toBe('Full outage: 0\nPartial outage: 0\nPerformance degradation: 0\nUnclear: 0');
  });

  it('appends URLs under each non-zero category', () => {
    const result = formatCustomerComplaintsForAttio({
      full_outage: 2,
      full_outage_urls: ['https://x.com/i/status/1', 'https://x.com/i/status/2'],
      partial_outage: 1,
      partial_outage_urls: ['https://x.com/i/status/3'],
      performance_degradation: 0,
      performance_degradation_urls: [],
      unclear: 3,
    });
    expect(result).toBe(
      'Full outage: 2\nhttps://x.com/i/status/1\nhttps://x.com/i/status/2\n' +
      'Partial outage: 1\nhttps://x.com/i/status/3\n' +
      'Performance degradation: 0\n' +
      'Unclear: 3'
    );
  });

  it('skips empty URL strings', () => {
    const result = formatCustomerComplaintsForAttio({
      full_outage: 1,
      full_outage_urls: [''],
      partial_outage: 0,
      partial_outage_urls: [],
      performance_degradation: 0,
      performance_degradation_urls: [],
      unclear: 0,
    });
    expect(result).toBe('Full outage: 1\nPartial outage: 0\nPerformance degradation: 0\nUnclear: 0');
  });
});

describe('parseCustomerComplaintsResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when companies array is empty', async () => {
    const results = await parseCustomerComplaintsResponse(makeTweets(['tweet']), []);
    expect(results).toHaveLength(0);
  });

  it('returns all-zeros without calling OpenAI when tweet array is empty', async () => {
    const results = await parseCustomerComplaintsResponse([], [company]);
    expect(results).toHaveLength(1);
    expect(results[0]!.data).toEqual({ full_outage: 0, full_outage_urls: [], partial_outage: 0, partial_outage_urls: [], performance_degradation: 0, performance_degradation_urls: [], unclear: 0 });
    expect(judge).not.toHaveBeenCalled();
  });

  it('groups tweet URLs by category from OpenAI per-tweet classification', async () => {
    vi.mocked(judge).mockResolvedValue({
      categories: ['full_outage', 'partial_outage', 'full_outage', 'unclear'],
    });

    const tweets = makeTweets(['down', 'partial', 'outage again', 'weird']);
    const results = await parseCustomerComplaintsResponse(tweets, [company]);

    expect(results[0]!.data.full_outage).toBe(2);
    expect(results[0]!.data.full_outage_urls).toEqual(['https://x.com/i/status/1', 'https://x.com/i/status/3']);
    expect(results[0]!.data.partial_outage).toBe(1);
    expect(results[0]!.data.partial_outage_urls).toEqual(['https://x.com/i/status/2']);
    expect(results[0]!.data.unclear).toBe(1);
    expect(judge).toHaveBeenCalledOnce();
  });

  it('does not include empty URLs in the url arrays', async () => {
    vi.mocked(judge).mockResolvedValue({ categories: ['full_outage'] });
    const tweets: TweetItem[] = [{ text: 'down', url: '' }];
    const results = await parseCustomerComplaintsResponse(tweets, [company]);
    expect(results[0]!.data.full_outage_urls).toEqual([]);
  });

  it('deduplicates tweets by URL before sending to OpenAI', async () => {
    vi.mocked(judge).mockResolvedValue({ categories: ['full_outage', 'partial_outage'] });
    const tweets: TweetItem[] = [
      { text: 'down', url: 'https://x.com/i/status/1' },
      { text: 'still down', url: 'https://x.com/i/status/1' },
      { text: 'partial', url: 'https://x.com/i/status/2' },
    ];
    const results = await parseCustomerComplaintsResponse(tweets, [company]);
    // OpenAI received 2 tweets (duplicate removed), classified as full_outage + partial_outage
    expect(results[0]!.data.full_outage).toBe(1);
    expect(results[0]!.data.partial_outage).toBe(1);
    const call = vi.mocked(judge).mock.calls[0]![0];
    expect(call.user).toContain('2. "partial"'); // 2 deduped tweets sent
    expect(call.user).not.toContain('"still down"'); // duplicate was dropped
  });

  it('silently drops not_about_company tweets from all counts', async () => {
    vi.mocked(judge).mockResolvedValue({
      categories: ['not_about_company', 'full_outage', 'not_about_company'],
    });
    const tweets = makeTweets(['unrelated', 'down', 'also unrelated']);
    const results = await parseCustomerComplaintsResponse(tweets, [company]);
    expect(results[0]!.data.full_outage).toBe(1);
    expect(results[0]!.data.partial_outage).toBe(0);
    expect(results[0]!.data.performance_degradation).toBe(0);
    expect(results[0]!.data.unclear).toBe(0);
    expect(results[0]!.data.full_outage_urls).toEqual(['https://x.com/i/status/2']);
  });

  it('passes company name and domain into the prompt', async () => {
    vi.mocked(judge).mockResolvedValue({ categories: ['unclear'] });
    await parseCustomerComplaintsResponse(makeTweets(['some tweet']), [company]);
    const call = vi.mocked(judge).mock.calls[0]![0];
    expect(call.user).toContain('Acme');
    expect(call.user).toContain('acme.com');
  });

  it('includes company context in the prompt when provided', async () => {
    vi.mocked(judge).mockResolvedValue({ categories: ['unclear'] });
    await parseCustomerComplaintsResponse(makeTweets(['some tweet']), [company], 'Acme is a B2B SaaS platform');
    const call = vi.mocked(judge).mock.calls[0]![0];
    expect(call.user).toContain('Acme is a B2B SaaS platform');
  });

  it('omits context line from prompt when context is empty', async () => {
    vi.mocked(judge).mockResolvedValue({ categories: ['unclear'] });
    await parseCustomerComplaintsResponse(makeTweets(['some tweet']), [company], '');
    const call = vi.mocked(judge).mock.calls[0]![0];
    expect(call.user).not.toContain('Company context:');
  });
});
