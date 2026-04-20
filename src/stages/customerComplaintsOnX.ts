import { judge } from '../apis/openai.js';
import { openaiLimit } from '../rateLimit.js';
import { withRetry } from '../util.js';
import type { StageCompany, StageResult } from './types.js';

export type CustomerComplaintsData = {
  full_outage: number;
  partial_outage: number;
  performance_degradation: number;
  unclear: number;
};

const CLASSIFIER_SYSTEM =
  'You are a tweet classifier. Classify each tweet into exactly one of: full_outage, partial_outage, performance_degradation, unclear.';

const CLASSIFIER_SCHEMA = {
  name: 'tweet_classification',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      full_outage: { type: 'number' as const },
      partial_outage: { type: 'number' as const },
      performance_degradation: { type: 'number' as const },
      unclear: { type: 'number' as const },
    },
    required: ['full_outage', 'partial_outage', 'performance_degradation', 'unclear'],
    additionalProperties: false,
  },
};

const ZERO_DATA: CustomerComplaintsData = {
  full_outage: 0,
  partial_outage: 0,
  performance_degradation: 0,
  unclear: 0,
};

export async function parseCustomerComplaintsResponse(
  tweets: string[],
  companies: StageCompany[]
): Promise<StageResult<CustomerComplaintsData>[]> {
  const company = companies[0];
  if (!company) return [];

  if (tweets.length === 0) {
    console.log(`[customerComplaintsOnX] ${company.domain}: 0 tweets — skipping OpenAI, writing all zeros`);
    return [{ company, data: { ...ZERO_DATA } }];
  }

  console.log(`[customerComplaintsOnX] ${company.domain}: classifying ${tweets.length} tweets via OpenAI`);

  const tweetList = tweets.map((t, i) => `${i + 1}. "${t}"`).join('\n');
  const userPrompt =
    `Here are ${tweets.length} tweets about ${company.companyName} being down or having issues.\n\n` +
    `For each tweet, classify it into ONE of:\n` +
    `- full_outage: service completely unreachable\n` +
    `- partial_outage: some features broken, not everything\n` +
    `- performance_degradation: slow, timeouts, intermittent failures\n` +
    `- unclear: cannot determine\n\n` +
    `Return ONLY this JSON:\n` +
    `{\n` +
    `  "full_outage": 0,\n` +
    `  "partial_outage": 0,\n` +
    `  "performance_degradation": 0,\n` +
    `  "unclear": 0\n` +
    `}\n\n` +
    `Tweets:\n${tweetList}`;

  const data = await openaiLimit(() =>
    withRetry(() => judge<CustomerComplaintsData>({ system: CLASSIFIER_SYSTEM, user: userPrompt, schema: CLASSIFIER_SCHEMA }), {
      tries: 3,
      baseMs: 1000,
      label: `customerComplaints:${company.domain}`,
    })
  );

  console.log(
    `[customerComplaintsOnX] ${company.domain} OpenAI result: full=${data.full_outage} partial=${data.partial_outage} perf=${data.performance_degradation} unclear=${data.unclear}`
  );
  return [{ company, data }];
}

export function formatCustomerComplaintsForAttio(d: CustomerComplaintsData): string {
  return [
    `Full outage: ${d.full_outage}`,
    `Partial outage: ${d.partial_outage}`,
    `Performance degradation: ${d.performance_degradation}`,
    `Unclear: ${d.unclear}`,
  ].join('\n');
}
