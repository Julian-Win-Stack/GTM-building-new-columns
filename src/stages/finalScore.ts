import { FIELD_SLUGS } from '../apis/attio.js';
import { judge } from '../apis/openai.js';
import { openaiLimit } from '../rateLimit.js';
import { withRetry } from '../util.js';
import { KEYS } from '../config.js';
import type { StageCompany } from './types.js';

export interface FinalScoreData {
  finalScore: number;
  tier: 1 | 2 | 3 | 4 | 5;
  reasoning: string;
}

export const FINAL_SCORE_INPUT_COLUMNS = [
  'Company Context Score',
  'Tooling Match Score',
  'Intent Signal Score',
] as const;

export function extractScoreFromContextCell(cell: string): number | null {
  const match = cell.match(/^([\d.]+)/);
  if (!match) return null;
  const n = parseFloat(match[1]!);
  return isNaN(n) ? null : n;
}

export function extractScoreFromToolingCell(cell: string): number | null {
  const match = cell.match(/^Final Tool Score:\s*([\d.]+)/m);
  if (!match) return null;
  const n = parseFloat(match[1]!);
  return isNaN(n) ? null : n;
}

export function extractScoreFromIntentCell(cell: string): number | null {
  const match = cell.match(/^Intent Signal Score:\s*([\d.]+)/m);
  if (!match) return null;
  const n = parseFloat(match[1]!);
  return isNaN(n) ? null : n;
}

export function computeFinalScore(inputs: {
  context: number;
  tooling: number;
  intent: number;
}): { finalScore: number; tier: 1 | 2 | 3 | 4 | 5 } {
  if (inputs.context === 0) {
    return { finalScore: 0, tier: 5 };
  }
  const raw = 0.5 * inputs.intent + 0.3 * inputs.context + 0.2 * inputs.tooling;
  // Round to 2dp first to prevent floating-point drift from pushing .X5 values below the rounding threshold
  const raw2dp = Math.round(raw * 100) / 100;
  const finalScore = Math.round(raw2dp * 10) / 10;
  let tier: 1 | 2 | 3 | 4 | 5;
  if (finalScore >= 4.5) tier = 1;
  else if (finalScore >= 3.5) tier = 2;
  else if (finalScore >= 2.5) tier = 3;
  else if (finalScore >= 1.5) tier = 4;
  else tier = 5;
  return { finalScore, tier };
}

const SYSTEM_PROMPT = `You are given 3 component scores for a company and must write a 2–4 sentence reasoning paragraph explaining how those scores combine into the provided Final Score and Tier. Do not recompute or restate the final score or tier — those are already provided. Only explain the reasoning based on each component score.

If any component score's underlying data is missing or not publicly confirmed, explicitly say: Not publicly confirmed.

Return JSON with a single field:
- reasoning: a 2–4 sentence paragraph`;

const REASONING_SCHEMA = {
  name: 'final_score_reasoning',
  strict: true,
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      reasoning: { type: 'string' as const },
    },
    required: ['reasoning'],
  },
};

export async function scoreFinal(
  company: StageCompany,
  values: Record<string, string>,
): Promise<FinalScoreData> {
  const contextSlug = FIELD_SLUGS['Company Context Score'] ?? '';
  const toolingSlug = FIELD_SLUGS['Tooling Match Score'] ?? '';
  const intentSlug = FIELD_SLUGS['Intent Signal Score'] ?? '';

  const contextCell = values[contextSlug] ?? '';
  const toolingCell = values[toolingSlug] ?? '';
  const intentCell = values[intentSlug] ?? '';

  const context = extractScoreFromContextCell(contextCell);
  const tooling = extractScoreFromToolingCell(toolingCell);
  const intent = extractScoreFromIntentCell(intentCell);

  if (context === null || tooling === null || intent === null) {
    throw new Error(`finalScore: failed to parse input scores for ${company.domain}`);
  }

  if (context === 0) {
    return {
      finalScore: 0,
      tier: 5,
      reasoning: 'Company Context Score is 0 — no meaningful digital surface. Final Score forced to 0 (Tier 5) by override.',
    };
  }

  const { finalScore, tier } = computeFinalScore({ context, tooling, intent });

  const lines: string[] = [];
  lines.push(`Company Name: ${company.companyName}`);
  lines.push(`Domain: ${company.domain}`);
  lines.push(`Computed Final Score: ${finalScore} (Tier ${tier})`);
  lines.push(`\n=== Company Context Score ===\n${contextCell || '(blank)'}`);
  lines.push(`\n=== Tooling Match Score ===\n${toolingCell || '(blank)'}`);
  lines.push(`\n=== Intent Signal Score ===\n${intentCell || '(blank)'}`);
  const user = lines.join('\n');

  const raw = await openaiLimit(() =>
    withRetry(
      () => judge<{ reasoning: string }>({
        system: SYSTEM_PROMPT,
        user,
        schema: REASONING_SCHEMA,
        model: KEYS.azureOpenAIDeployment,
      }),
      { tries: 3, baseMs: 1000, label: `finalScore:${company.domain}` },
    )
  );

  return { finalScore, tier, reasoning: raw.reasoning };
}

export function formatFinalScoreForAttio(d: FinalScoreData): string {
  return `Final Score: ${d.finalScore}\nTier: Tier ${d.tier}\n\nReasoning:\n${d.reasoning}`;
}
