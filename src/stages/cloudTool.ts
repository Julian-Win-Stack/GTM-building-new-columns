import type { ExaSearchResponse } from '../apis/exa.js';
import type { GateRule, StageCompany, StageResult } from './types.js';

export type CloudToolData = {
  tool: string;
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
};

const PASS_TOOLS: ReadonlySet<string> = new Set(['aws', 'gcp', 'both', 'no evidence found']);

const VALID_CONFIDENCE: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, '');
}

function extractParsedObject(raw: ExaSearchResponse): Record<string, unknown> | null {
  const content = raw.output?.content;
  if (content && typeof content === 'object') return content as Record<string, unknown>;
  return null;
}

export function parseCloudToolResponse(
  raw: ExaSearchResponse,
  companies: StageCompany[]
): StageResult<CloudToolData>[] {
  const parsedMap = new Map<string, CloudToolData>();
  const payload = extractParsedObject(raw);
  const items = Array.isArray(payload?.['companies']) ? (payload!['companies'] as unknown[]) : [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const domainRaw = typeof rec['domain'] === 'string' ? rec['domain'] : '';
    const tool = typeof rec['tool'] === 'string' ? rec['tool'] : '';
    const evidence = typeof rec['evidence'] === 'string' ? rec['evidence'] : null;
    const confidenceRaw = typeof rec['confidence'] === 'string' ? rec['confidence'].toLowerCase() : '';
    if (!domainRaw || !tool || evidence === null || !VALID_CONFIDENCE.has(confidenceRaw)) continue;
    parsedMap.set(normalizeDomain(domainRaw), {
      tool,
      evidence,
      confidence: confidenceRaw as CloudToolData['confidence'],
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
      `[cloudTool] parse miss — expected=[${companies.map((c) => c.domain).join(', ')}] parsed=[${[...parsedMap.keys()].join(', ')}] missing=[${missing.join(', ')}]`
    );

  }

  return results;
}

export const cloudToolGate: GateRule<CloudToolData> = (d) =>
  PASS_TOOLS.has(d.tool.trim().toLowerCase());

export function formatCloudToolForAttio(d: CloudToolData): string {
  if (d.tool.trim().toLowerCase() === 'no evidence found') return 'No evidence found';
  return `${d.tool}: ${d.evidence}`;
}

export const cloudToolCacheGate = (cached: string): boolean => {
  const trimmed = cached.trim();
  if (!trimmed) return false;
  if (trimmed === 'No evidence found') return true;
  const toolName = trimmed.split(':')[0]?.trim().toLowerCase() ?? '';
  return toolName === 'aws' || toolName === 'gcp' || toolName === 'both';
};
