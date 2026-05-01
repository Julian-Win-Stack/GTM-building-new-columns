import { FIELD_SLUGS } from '../apis/attio.js';
import { judge, AZURE_DEPLOYMENT_PRO } from '../apis/openai.js';
import { openaiLimit } from '../rateLimit.js';
import { withRetry } from '../util.js';
import type { StageCompany } from './types.js';

export interface ToolingMatchScoreData {
  communicationToolScore: 0 | 3 | 5;
  competitorToolingScore: 1 | 3 | 5;
  observabilityToolScore: 1 | 3 | 4 | 5;
  cloudToolScore: 4 | 5;
  finalToolScore: number;
  justification: {
    communicationTool: string;
    competitorTooling: string;
    observabilityTool: string;
    cloudTool: string;
  };
}

interface RawToolingMatchResponse {
  communication_tool_score: number;
  competitor_tooling_score: number;
  observability_tool_score: number;
  cloud_tool_score: number;
  justification: {
    communication_tool: string;
    competitor_tooling: string;
    observability_tool: string;
    cloud_tool: string;
  };
}

export const TOOLING_MATCH_INPUT_COLUMNS = [
  'Communication Tool',
  'Competitor Tooling',
  'Observability Tool',
  'Cloud Tool',
] as const;

const COMM_VALID = new Set<number>([0, 3, 5]);
const COMP_VALID = new Set<number>([1, 3, 5]);
const OBS_VALID = new Set<number>([1, 3, 4, 5]);
const CLOUD_VALID = new Set<number>([4, 5]);

export function parseToolingMatchResponse(raw: RawToolingMatchResponse): ToolingMatchScoreData {
  const c = raw.communication_tool_score;
  const comp = raw.competitor_tooling_score;
  const o = raw.observability_tool_score;
  const cl = raw.cloud_tool_score;

  if (!COMM_VALID.has(c)) throw new Error(`toolingMatch: invalid communication_tool_score "${c}"`);
  if (!COMP_VALID.has(comp)) throw new Error(`toolingMatch: invalid competitor_tooling_score "${comp}"`);
  if (!OBS_VALID.has(o)) throw new Error(`toolingMatch: invalid observability_tool_score "${o}"`);
  if (!CLOUD_VALID.has(cl)) throw new Error(`toolingMatch: invalid cloud_tool_score "${cl}"`);

  return {
    communicationToolScore: c as 0 | 3 | 5,
    competitorToolingScore: comp as 1 | 3 | 5,
    observabilityToolScore: o as 1 | 3 | 4 | 5,
    cloudToolScore: cl as 4 | 5,
    finalToolScore: (c + comp + o + cl) / 4,
    justification: {
      communicationTool: raw.justification.communication_tool,
      competitorTooling: raw.justification.competitor_tooling,
      observabilityTool: raw.justification.observability_tool,
      cloudTool: raw.justification.cloud_tool,
    },
  };
}

const SYSTEM_PROMPT = `You are evaluating a company's tooling stack for Bacca.ai, an AI SRE (Site Reliability Engineering) startup. Score the company across the 4 categories below, then return structured JSON.

Use the evidence from the company's enrichment data provided. If a category has no evidence, apply the "else" rule and write "Not publicly confirmed" in that justification field.

──────────────────────────────────────────────
1. Communication Tool Score
• 5 if Slack is confirmed
• 3 if no evidence found
• 0 if Microsoft Teams is confirmed

Priority:
  Teams → 0
  Slack → 5
  Else → 3

──────────────────────────────────────────────
2. Competitor Tooling Score (Incident / On-call)
• 5 if no competitor tools are confirmed
• 3 if Rootly or incident.io is confirmed
• 1 if any of the following are confirmed:
  Resolve.ai, Traversal, TierZero, RunLLM, Neubird, Wildmoose, Ciroos, Komodor, Mezmo

Priority:
  If any "1-point" competitor is present → 1
  Else if Rootly / incident.io → 3
  Else → 5

──────────────────────────────────────────────
3. Observability Tool Score
• 5 if Datadog is the sole observability tool
• 4 if Datadog, Grafana, or Prometheus is used (but not sole Datadog)
• 3 if no evidence found
• 1 if another tool is the sole observability tool (e.g., Dynatrace, New Relic)

Priority:
  Other sole tool → 1
  Datadog only → 5
  Datadog / Grafana / Prometheus → 4
  Else → 3

"Datadog only" means Datadog is the SOLE observability tool. If any other tool appears alongside Datadog, the score drops to 4.

Examples:
  - Datadog alone → 5
  - Datadog + Grafana → 4
  - Datadog + Prometheus → 4
  - Only Grafana → 4
  - Only Prometheus → 4
  - Grafana + Prometheus → 4
  - Only Dynatrace (or only New Relic, Splunk, etc.) → 1
  - No evidence found → 3

──────────────────────────────────────────────
4. Cloud Tool Score
• 5 if AWS or GCP is confirmed
• 4 if Azure is confirmed
• 4 if not publicly confirmed

Priority:
  AWS / GCP → 5
  Azure → 4
  Else → 4

──────────────────────────────────────────────
Return JSON with:
  - communication_tool_score (integer: 0, 3, or 5)
  - competitor_tooling_score (integer: 1, 3, or 5)
  - observability_tool_score (integer: 1, 3, 4, or 5)
  - cloud_tool_score (integer: 4 or 5)
  - justification: object with keys communication_tool, competitor_tooling, observability_tool, cloud_tool — each a brief string. If evidence is missing, write "Not publicly confirmed".`;

const SCORE_SCHEMA = {
  name: 'tooling_match_score',
  strict: true,
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      communication_tool_score: { type: 'number' as const, enum: [0, 3, 5] },
      competitor_tooling_score: { type: 'number' as const, enum: [1, 3, 5] },
      observability_tool_score: { type: 'number' as const, enum: [1, 3, 4, 5] },
      cloud_tool_score: { type: 'number' as const, enum: [4, 5] },
      justification: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          communication_tool: { type: 'string' as const },
          competitor_tooling: { type: 'string' as const },
          observability_tool: { type: 'string' as const },
          cloud_tool: { type: 'string' as const },
        },
        required: ['communication_tool', 'competitor_tooling', 'observability_tool', 'cloud_tool'],
      },
    },
    required: [
      'communication_tool_score',
      'competitor_tooling_score',
      'observability_tool_score',
      'cloud_tool_score',
      'justification',
    ],
  },
};

const FIELDS_FOR_PROMPT = TOOLING_MATCH_INPUT_COLUMNS;

export async function scoreToolingMatch(
  company: StageCompany,
  values: Record<string, string>,
): Promise<ToolingMatchScoreData> {
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
      () => judge<RawToolingMatchResponse>({
        system: SYSTEM_PROMPT,
        user,
        schema: SCORE_SCHEMA,
        model: AZURE_DEPLOYMENT_PRO,
      }),
      { tries: 3, baseMs: 1000, label: `toolingMatch:${company.domain}` },
    )
  );

  return parseToolingMatchResponse(raw);
}

export function formatToolingMatchScoreForAttio(d: ToolingMatchScoreData): string {
  return [
    `Final Tool Score: ${d.finalToolScore}`,
    `Communication Tool Score: ${d.communicationToolScore}`,
    `Competitor Tooling Score: ${d.competitorToolingScore}`,
    `Observability Tool Score: ${d.observabilityToolScore}`,
    `Cloud Tool Score: ${d.cloudToolScore}`,
    '',
    'Justification:',
    `- Communication Tool: ${d.justification.communicationTool}`,
    `- Competitor Tooling: ${d.justification.competitorTooling}`,
    `- Observability Tool: ${d.justification.observabilityTool}`,
    `- Cloud Tool: ${d.justification.cloudTool}`,
  ].join('\n');
}
