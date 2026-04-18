import type { ExaSearchResponse } from '../apis/exa.js';
import type { GateRule, StageCompany, StageResult } from './types.js';

export type DigitalNativeCategory =
  | 'Digital-native B2C'
  | 'Digital-native B2B'
  | 'Digital-native B2B2C'
  | 'Digital-native B2C2B'
  | 'NOT Digital-native';

export type DigitalNativeData = {
  category: DigitalNativeCategory;
  confidence: string;
  reason: string;
};

export function parseDigitalNativeResponse(
  raw: ExaSearchResponse,
  companies: StageCompany[]
): StageResult<DigitalNativeData>[] {
  const blocks = raw.output.content.split(/\n[ \t]*\n+/);

  const parsed = new Map<string, DigitalNativeData>();
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 4) continue;
    const domain = lines[0]?.trim().toLowerCase().replace(/^www\./, '') ?? '';
    const categoryMatch = block.match(/^CATEGORY:\s*(.+)$/m);
    const confidenceMatch = block.match(/^CONFIDENCE:\s*(.+)$/m);
    const reasonMatch = block.match(/^REASON:\s*([\s\S]+?)(?=\n[A-Z]+:|$)/m);
    const category = categoryMatch?.[1]?.trim();
    const confidence = confidenceMatch?.[1]?.trim();
    const reason = reasonMatch?.[1]?.trim();
    if (!category || !confidence || !reason || !domain) continue;
    parsed.set(domain, {
      category: category as DigitalNativeCategory,
      confidence,
      reason,
    });
  }

  return companies.map((company) => {
    const data = parsed.get(company.domain);
    if (!data) return { company, error: 'no output from Exa' };
    return { company, data };
  });
}

export const digitalNativeGate: GateRule<DigitalNativeData> = (d) =>
  d.category !== 'NOT Digital-native' && d.category !== 'Digital-native B2B';

export function formatDigitalNativeForAttio(d: DigitalNativeData): string {
  return `${d.category}\nConfidence: ${d.confidence}\nReasoning: ${d.reason}`;
}
