import { judge } from '../apis/openai.js';
import { openaiLimit } from '../rateLimit.js';
import { withRetry } from '../util.js';
import type { TweetItem } from '../apis/twitterapi.js';
import type { StageCompany, StageResult } from './types.js';

export type CustomerComplaintsData = {
  full_outage: number;
  full_outage_urls: string[];
  partial_outage: number;
  partial_outage_urls: string[];
  performance_degradation: number;
  performance_degradation_urls: string[];
  unclear: number;
};

type TweetCategory = 'full_outage' | 'partial_outage' | 'performance_degradation' | 'unclear' | 'not_about_company';

const CLASSIFIER_SYSTEM =
  'You are a tweet classifier. Classify each tweet into exactly one of: full_outage, partial_outage, performance_degradation, unclear, not_about_company.';

const CLASSIFIER_SCHEMA = {
  name: 'tweet_classification',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      categories: {
        type: 'array' as const,
        items: {
          type: 'string' as const,
          enum: ['full_outage', 'partial_outage', 'performance_degradation', 'unclear', 'not_about_company'],
        },
      },
    },
    required: ['categories'],
    additionalProperties: false,
  },
};

const ZERO_DATA: CustomerComplaintsData = {
  full_outage: 0,
  full_outage_urls: [],
  partial_outage: 0,
  partial_outage_urls: [],
  performance_degradation: 0,
  performance_degradation_urls: [],
  unclear: 0,
};

export async function parseCustomerComplaintsResponse(
  tweets: TweetItem[],
  companies: StageCompany[],
  companyContext = ''
): Promise<StageResult<CustomerComplaintsData>[]> {
  const company = companies[0];
  if (!company) return [];

  if (tweets.length === 0) {
    console.log(`[customerComplaintsOnX] ${company.domain}: 0 tweets — skipping OpenAI, writing all zeros`);
    return [{ company, data: { ...ZERO_DATA } }];
  }

  const seen = new Set<string>();
  const dedupedTweets = tweets.filter((t) => {
    if (!t.url) return true;
    if (seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });

  console.log(`[customerComplaintsOnX] ${company.domain}: classifying ${dedupedTweets.length} tweets via OpenAI (${tweets.length - dedupedTweets.length} duplicate URLs removed)`);

  const tweetList = dedupedTweets.map((t, i) => `${i + 1}. "${t.text}"`).join('\n');
  const contextLine = companyContext ? `\nCompany context: ${companyContext}\n` : '';
  const userPrompt =
    `Here are the tweets that may or may not be about ${company.companyName} (${company.domain}) having reliability issues about their digital platform.Here is the information about what the company is:${contextLine}\n` +
    `For each tweet, classify it into ONE of:\n` +
    `- full_outage: tweet is about ${company.companyName}'s digital platform being completely unreachable\n` +
    `- partial_outage: tweet is about ${company.companyName}'s digital platform having some features broken, not everything\n` +
    `- performance_degradation: tweet is about ${company.companyName}'s digital platform being slow, with timeouts, or intermittent failures\n` +
    `- not_about_company: tweet is not about ${company.companyName} or is not about a reliability issue with their digital platform\n` +
    `- unclear: tweet seems to be about ${company.companyName} but cannot determine whether the issue is for their digital platform\n\n` +
    `Return a JSON object with a "categories" array containing one label per tweet, in the same order as the input.\n\n` +
    `Tweets:\n${tweetList}`;

  const result = await openaiLimit(() =>
    withRetry(() => judge<{ categories: string[] }>({ system: CLASSIFIER_SYSTEM, user: userPrompt, schema: CLASSIFIER_SCHEMA }), {
      tries: 3,
      baseMs: 1000,
      label: `customerComplaints:${company.domain}`,
    })
  );

  const data: CustomerComplaintsData = { ...ZERO_DATA, full_outage_urls: [], partial_outage_urls: [], performance_degradation_urls: [] };

  for (let i = 0; i < dedupedTweets.length; i++) {
    const category = (result.categories[i] ?? 'unclear') as TweetCategory;
    const url = dedupedTweets[i]!.url;
    if (category === 'not_about_company') {
      // silently dropped — tweet is not about this company's platform
    } else if (category === 'full_outage') {
      data.full_outage++;
      if (url) data.full_outage_urls.push(url);
    } else if (category === 'partial_outage') {
      data.partial_outage++;
      if (url) data.partial_outage_urls.push(url);
    } else if (category === 'performance_degradation') {
      data.performance_degradation++;
      if (url) data.performance_degradation_urls.push(url);
    } else {
      data.unclear++;
    }
  }

  console.log(
    `[customerComplaintsOnX] ${company.domain} OpenAI result: full=${data.full_outage} partial=${data.partial_outage} perf=${data.performance_degradation} unclear=${data.unclear}`
  );
  return [{ company, data }];
}

export function formatCustomerComplaintsForAttio(d: CustomerComplaintsData): string {
  const lines: string[] = [];

  lines.push(`Full outage: ${d.full_outage}`);
  for (const url of d.full_outage_urls) if (url) lines.push(url);

  lines.push(`Partial outage: ${d.partial_outage}`);
  for (const url of d.partial_outage_urls) if (url) lines.push(url);

  lines.push(`Performance degradation: ${d.performance_degradation}`);
  for (const url of d.performance_degradation_urls) if (url) lines.push(url);

  lines.push(`Unclear: ${d.unclear}`);

  return lines.join('\n');
}
