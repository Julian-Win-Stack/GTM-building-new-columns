import crypto from 'node:crypto';
import { FIELD_SLUGS } from '../apis/attio.js';
import { judge, AZURE_DEPLOYMENT_PRO } from '../apis/openai.js';
import { openaiLimit } from '../rateLimit.js';
import { withRetry } from '../util.js';
import type { StageCompany } from './types.js';

export type ContextScoreValue = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5;

export interface ContextScoreData {
  score: ContextScoreValue;
  reasoning: string;
}

const VALID_SCORES = new Set<number>([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);

export function computeInputHash(values: Record<string, string>, slugs: readonly string[]): string {
  const concat = slugs.map((s) => `${s}=${values[s] ?? ''}`).join('\n---\n');
  return crypto.createHash('sha256').update(concat).digest('hex');
}

const SYSTEM_PROMPT = `You are evaluating a company's fit for Bacca.ai, an AI SRE (site reliability engineering) startup that sells to high-scale digital-native platforms where outages directly hurt revenue or core UX.

Score the company 0–5 using 0.5 increments against the Company Context Score framework below. Base the score on product nature (real-time/transactional/production-critical), reliability sensitivity (how directly outages hurt revenue or UX), industry, number of users, and business model.

<FRAMEWORK>
5 – Ideal ICP: real-time high-frequency systems; outages immediately hit revenue. Industries: Fintech, Payments, E-commerce, Marketplaces, On-demand/Delivery, Logistics/Mobility, Travel/Booking, real-time Consumer social, Real-time communications, production-facing Data/AI platforms. Scale: typically 10M+ users. Pure B2C. Examples: Robinhood, Stripe, Whatnot, Uber, Twilio, DoorDash, Airbnb.

4 – Strong Fit: high engagement, not always transactional. Industries: Media/Streaming, Gaming, Creator economy, SaaS (prosumer/PLG), Adtech/Martech. Scale: 1M–100M users. B2C or B2C2B. Examples: Notion, Canva, Pinterest, Duolingo, Spotify, Twitch.

3 – Moderate Fit: consumer layer exists, reliability less tied to revenue. Industries: Developer tools/APIs, B2C2B marketplaces, non-real-time Food tech, mixed consumer+SMB. Scale: 100K–10M. B2B2C/B2C2B. Examples: Postman, Substack, Faire, ClassPass.

2 – Weak Fit: limited real-time, lower engagement. Industries: niche consumer, early-stage marketplaces, SMB-focused, non-critical IoT. Scale: under 1M or unclear.

1 – Poor Fit: internal workflows, SLA-driven not user-driven. Industries: B2B SaaS (internal tools/back-office), Cybersecurity, non-real-time B2B. Examples: ServiceNow, Workday, Okta.

0 – No Fit: no meaningful digital surface. Industries: brick-and-mortar, manufacturing, construction, offline logistics, non-digital gov.
</FRAMEWORK>

RULES:
- Use whole or 0.5 increments only.
- Prioritize reliability sensitivity and product criticality over industry label.
- A strong-fit-industry company can score lower if scale/usage/outage-sensitivity is limited.
- A company outside listed industries can still score well if product is highly real-time and outage-sensitive.
- If any key signal is not publicly confirmed, say so explicitly in reasoning.
- "Digitally critical B2C" scores identically to "Digital-native B2C"; "Digitally critical B2B" to "Digital-native B2B"; "Digitally critical B2B2C" to "Digital-native B2B2C"; "Digitally critical B2C2B" to "Digital-native B2C2B". The prefix indicates a traditional company with a business-critical digital surface — the scoring logic is the same.

Return JSON with: score (one of 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5) and reasoning (2–4 sentences referencing product nature, reliability sensitivity, industry, scale, and business model).`;

const SCORE_SCHEMA = {
  name: 'company_context_score',
  strict: true,
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      score: { type: 'number' as const, enum: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] },
      reasoning: { type: 'string' as const },
    },
    required: ['score', 'reasoning'],
  },
};

const FIELDS_FOR_PROMPT = [
  'Description',
  'Industry',
  'Digital Native',
  'Number of Users',
  'Revenue Growth',
  'Funding Growth',
  'Competitor Tooling',
  'Number of Engineers',
  'Number of SREs',
  'Engineer Hiring',
  'SRE Hiring',
  'Observability Tool',
  'Cloud Tool',
  'Communication Tool',
  'Customer complains on X',
  'Recent incidents ( Official )',
  'AI adoption mindset',
  'AI SRE maturity',
] as const;

export async function scoreCompanyContext(
  company: StageCompany,
  values: Record<string, string>,
): Promise<ContextScoreData> {
  const lines: string[] = [];
  lines.push(`Company Name: ${company.companyName}`);
  lines.push(`Domain: ${company.domain}`);
  for (const field of FIELDS_FOR_PROMPT) {
    const slug = FIELD_SLUGS[field] ?? '';
    if (!slug) continue;
    const val = values[slug] ?? '';
    lines.push(`\n=== ${field} ===\n${val || '(blank)'}`);
  }
  const user = lines.join('\n');

  const result = await openaiLimit(() =>
    withRetry(
      () => judge<ContextScoreData>({
        system: SYSTEM_PROMPT,
        user,
        schema: SCORE_SCHEMA,
        model: AZURE_DEPLOYMENT_PRO,
      }),
      { tries: 3, baseMs: 1000, label: `contextScore:${company.domain}` },
    )
  );

  if (!VALID_SCORES.has(result.score)) {
    throw new Error(`contextScore: invalid score "${result.score}" for ${company.domain}`);
  }
  return result;
}

export function formatContextScoreForAttio(d: ContextScoreData): string {
  return `${d.score}\n\nReasoning: ${d.reasoning}`;
}
