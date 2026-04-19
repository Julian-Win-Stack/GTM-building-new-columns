import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany, StageResult } from './types.js';

export type FundingGrowthData = {
  growth: string;
  timeframe: string;
  evidence: string;
};

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, '');
}

function extractParsedObject(raw: ExaSearchResponse): Record<string, unknown> | null {
  const content = raw.output?.content;
  if (content && typeof content === 'object') return content as Record<string, unknown>;
  return null;
}

export function parseFundingGrowthResponse(
  raw: ExaSearchResponse,
  companies: StageCompany[]
): StageResult<FundingGrowthData>[] {
  const parsedMap = new Map<string, FundingGrowthData>();
  const payload = extractParsedObject(raw);
  const items = Array.isArray(payload?.['companies']) ? (payload!['companies'] as unknown[]) : [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const domainRaw = typeof rec['domain'] === 'string' ? rec['domain'] : '';
    const growth = typeof rec['growth'] === 'string' ? rec['growth'] : '';
    const timeframe = typeof rec['timeframe'] === 'string' ? rec['timeframe'] : '';
    const evidence = typeof rec['evidence'] === 'string' ? rec['evidence'] : '';
    if (!domainRaw || !growth) continue;
    parsedMap.set(normalizeDomain(domainRaw), { growth, timeframe, evidence });
  }

  const results = companies.map((company) => {
    const data = parsedMap.get(company.domain);
    if (!data) return { company, error: 'no output from Exa' };
    return { company, data };
  });

  const missing = results.filter((r) => r.error !== undefined).map((r) => r.company.domain);
  if (missing.length > 0) {
    console.log(
      `[fundingGrowth] parse miss — expected=[${companies.map((c) => c.domain).join(', ')}] parsed=[${[...parsedMap.keys()].join(', ')}] missing=[${missing.join(', ')}]`
    );

  }

  return results;
}

export function formatFundingGrowthForAttio(d: FundingGrowthData): string {
  const parts = [`Growth: ${d.growth}`];
  if (d.timeframe) parts.push(`Timeframe: ${d.timeframe}`);
  if (d.evidence) parts.push(`Evidence: ${d.evidence}`);
  return parts.join('\n\n');
}
