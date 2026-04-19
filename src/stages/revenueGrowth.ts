import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany, StageResult } from './types.js';

export type RevenueGrowthData = {
  growth: string;
  evidence: string;
  source_date: string;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
};

const VALID_CONFIDENCE: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, '');
}

function extractParsedObject(raw: ExaSearchResponse): Record<string, unknown> | null {
  const content = raw.output?.content;
  if (content && typeof content === 'object') return content as Record<string, unknown>;
  return null;
}

export function parseRevenueGrowthResponse(
  raw: ExaSearchResponse,
  companies: StageCompany[]
): StageResult<RevenueGrowthData>[] {
  const parsedMap = new Map<string, RevenueGrowthData>();
  const payload = extractParsedObject(raw);
  const items = Array.isArray(payload?.['companies']) ? (payload!['companies'] as unknown[]) : [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const domainRaw = typeof rec['domain'] === 'string' ? rec['domain'] : '';
    const growth = typeof rec['growth'] === 'string' ? rec['growth'] : '';
    const evidence = typeof rec['evidence'] === 'string' ? rec['evidence'] : '';
    const source_date = typeof rec['source_date'] === 'string' ? rec['source_date'] : '';
    const reasoning = typeof rec['reasoning'] === 'string' ? rec['reasoning'] : '';
    const confidenceRaw = typeof rec['confidence'] === 'string' ? rec['confidence'].toLowerCase() : '';
    if (!domainRaw || !growth || !VALID_CONFIDENCE.has(confidenceRaw)) continue;
    parsedMap.set(normalizeDomain(domainRaw), {
      growth,
      evidence,
      source_date,
      reasoning,
      confidence: confidenceRaw as RevenueGrowthData['confidence'],
    });
  }

  const results = companies.map((company) => {
    const data = parsedMap.get(company.domain);
    if (!data) return { company, error: 'no output from Exa' };
    return { company, data };
  });

  const missing = results.filter((r) => r.error !== undefined).map((r) => r.company.domain);
  if (missing.length > 0) {
    console.log(
      `[revenueGrowth] parse miss — expected=[${companies.map((c) => c.domain).join(', ')}] parsed=[${[...parsedMap.keys()].join(', ')}] missing=[${missing.join(', ')}]`
    );

  }

  return results;
}

export function formatRevenueGrowthForAttio(d: RevenueGrowthData): string {
  const parts = [`Growth: ${d.growth}`];
  if (d.evidence) parts.push(`Evidence: ${d.evidence}`);
  if (d.source_date) parts.push(`Source date: ${d.source_date}`);
  if (d.reasoning) parts.push(`Reasoning: ${d.reasoning}`);
  parts.push(`Confidence: ${d.confidence}`);
  return parts.join('\n\n');
}
