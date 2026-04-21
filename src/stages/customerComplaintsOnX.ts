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

type TweetCategory = 'full_outage' | 'partial_outage' | 'performance_degradation' | 'unclear';

const CLASSIFIER_SYSTEM =
  'You are a tweet classifier. Classify each tweet into exactly one of: full_outage, partial_outage, performance_degradation, unclear.';

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
          enum: ['full_outage', 'partial_outage', 'performance_degradation', 'unclear'],
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
  companies: StageCompany[]
): Promise<StageResult<CustomerComplaintsData>[]> {
  const company = companies[0];
  if (!company) return [];

  if (tweets.length === 0) {
    console.log(`[customerComplaintsOnX] ${company.domain}: 0 tweets — skipping OpenAI, writing all zeros`);
    return [{ company, data: { ...ZERO_DATA } }];
  }

  console.log(`[customerComplaintsOnX] ${company.domain}: classifying ${tweets.length} tweets via OpenAI`);

  const tweetList = tweets.map((t, i) => `${i + 1}. "${t.text}"`).join('\n');
  const userPrompt =
    `Here are ${tweets.length} tweets about ${company.companyName} being down or having issues.\n\n` +
    `For each tweet, classify it into ONE of:\n` +
    `- full_outage: service completely unreachable\n` +
    `- partial_outage: some features broken, not everything\n` +
    `- performance_degradation: slow, timeouts, intermittent failures\n` +
    `- unclear: cannot determine\n\n` +
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

  for (let i = 0; i < tweets.length; i++) {
    const category = (result.categories[i] ?? 'unclear') as TweetCategory;
    const url = tweets[i]!.url;
    if (category === 'full_outage') {
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
