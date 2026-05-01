import { FIELD_SLUGS } from '../apis/attio.js';
import { judge, AZURE_DEPLOYMENT } from '../apis/openai.js';
import { openaiLimit } from '../rateLimit.js';
import { withRetry } from '../util.js';
import type { StageCompany } from './types.js';

export type IntentSignalScoreValue = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5;

export interface IntentSignalScoreData {
  score: IntentSignalScoreValue;
  reasoning: string;
}

interface RawIntentSignalResponse {
  score: number;
  reasoning: string;
}

const VALID_SCORES = new Set<number>([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);

export const INTENT_SIGNAL_INPUT_COLUMNS = [
  // Tier 1
  'Customer complains on X',
  'Engineer Hiring',
  'SRE Hiring',
  'AI SRE maturity',
  // Tier 2
  'Recent incidents ( Official )',
  'AI adoption mindset',
  // Tier 3
  'Funding Growth',
  'Revenue Growth',
] as const;

export function parseIntentSignalResponse(raw: RawIntentSignalResponse, domain: string): IntentSignalScoreData {
  if (!VALID_SCORES.has(raw.score)) {
    throw new Error(`intentSignal: invalid score "${raw.score}" for ${domain}`);
  }
  return { score: raw.score as IntentSignalScoreValue, reasoning: raw.reasoning };
}

const SYSTEM_PROMPT = `You are evaluating a company's buying intent for Bacca.ai, an AI SRE startup. Assign an Intent Signal Score from 0 to 5 using 0.5 increments.

Only use publicly verifiable signals. If data is missing, state: Not publicly confirmed.

──────────────────────────────────────────────
Scoring Priorities (in order of importance)

Tier 1 — Most Important (anchor signals)
• Customer complaints (X, Reddit, etc.)
• Engineer / SRE hiring
• SRE maturity (in-house building / ideation vs vendor reliance)

Tier 2 — Secondary signals
• Recent incidents (last 90 days)
• AI adoption mindset

Tier 3 — Least Important
• Funding growth (6 months)
• Revenue growth (6 months)

──────────────────────────────────────────────
Intent Signal Score Framework

5 – Very High Intent
Clear, urgent pain + strong readiness to act (especially across Tier 1)
Pattern:
• Strong customer complaints or visible user frustration
• Active SRE / engineer hiring (multiple roles or clear focus)
• SRE maturity: building in-house, ideating
• Recent incidents present and impactful
• AI adoption: aggressive (especially in ops, automation, or infra)

4 – High Intent
Strong Tier 1 signals, with partial Tier 2 support
Pattern:
• Clear customer complaints OR strong SRE hiring (but not both at full strength)
• SRE maturity: building in-house, ideating
• Some recent incidents (not constant)
• AI adoption mindset: neutral

3 – Moderate Intent
Mixed or incomplete signals
Pattern:
• Limited customer complaints or unclear severity
• Light SRE hiring OR mostly general engineering roles
• SRE maturity: working with vendor
• Few or unclear recent incidents
• AI adoption mindset: neutral

2 – Low Intent
Weak Tier 1 signals regardless of Tier 2
Pattern:
• Little to no customer complaints
• Minimal or no SRE hiring
• SRE maturity: not ready or unverified
• Few or no incidents
• AI adoption mindset: conservative

1 – Very Low Intent
Almost no signal across key areas
Pattern:
• No meaningful customer complaints
• No SRE or relevant hiring
• No evidence of SRE maturity (no in-house effort)
• No incidents found
• AI adoption mindset: conservative

0 – No Signal
Insufficient public data across signals

──────────────────────────────────────────────
Return JSON with:
- score (one of 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)
- reasoning: 2–4 sentences covering customer complaints, hiring (Engineer / SRE), SRE maturity, incidents, and AI adoption. If any data is missing, explicitly say: Not publicly confirmed.`;

const SCORE_SCHEMA = {
  name: 'intent_signal_score',
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

const FIELDS_FOR_PROMPT = INTENT_SIGNAL_INPUT_COLUMNS;

export async function scoreIntentSignal(
  company: StageCompany,
  values: Record<string, string>,
): Promise<IntentSignalScoreData> {
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

  const raw = await openaiLimit(() =>
    withRetry(
      () => judge<RawIntentSignalResponse>({
        system: SYSTEM_PROMPT,
        user,
        schema: SCORE_SCHEMA,
        model: AZURE_DEPLOYMENT,
      }),
      { tries: 3, baseMs: 1000, label: `intentSignal:${company.domain}` },
    )
  );

  return parseIntentSignalResponse(raw, company.domain);
}

export function formatIntentSignalScoreForAttio(d: IntentSignalScoreData): string {
  return `Intent Signal Score: ${d.score}\n\nReasoning:\n${d.reasoning}`;
}
