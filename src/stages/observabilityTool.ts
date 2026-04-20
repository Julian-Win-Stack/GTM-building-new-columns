import type { ExaSearchResponse } from '../apis/exa.js';
import { collectJobUrls, theirstackJobsByAnySlugs } from '../apis/theirstack.js';
import { judge } from '../apis/openai.js';
import { openaiLimit, scheduleTheirstack } from '../rateLimit.js';
import { withRetry } from '../util.js';
import type { GateRule, StageCompany, StageResult } from './types.js';

export type ObservabilityToolData = {
  tools: Array<{ name: string; sourceUrl: string }>;
};

const ALLOWLIST: ReadonlySet<string> = new Set(['datadog', 'grafana', 'prometheus']);

const THEIRSTACK_GATE_SLUGS = ['datadog', 'grafana'] as const;
const THEIRSTACK_OTHER_SLUGS = [
  'chronosphere', 'coralogix', 'dynatrace', 'honeycomb', 'netdata', 'new-relic',
] as const;
const SLUG_DISPLAY: Record<string, string> = {
  datadog: 'Datadog', grafana: 'Grafana',
  chronosphere: 'Chronosphere', coralogix: 'Coralogix',
  dynatrace: 'Dynatrace', honeycomb: 'Honeycomb',
  netdata: 'Netdata', 'new-relic': 'New Relic',
};

const LINKEDIN_VERIFIER_SYSTEM = `You are a strict evidence verifier.

You will be given the scraped text of a LinkedIn profile page, a target company name and domain, and an observability tool name. Your job is to decide whether the profile text contains evidence that the person used this observability tool while working at the TARGET company.

Rules:
- Respond "yes" only if the tool is clearly mentioned in a job experience block that belongs to the target company.
- Respond "no" if the tool appears under a different employer's experience block, or if you cannot clearly attribute it to the target company.
- Respond "no" if the profile text is empty, garbled, or shows a login wall.
- When in doubt, respond "no".`;

const LINKEDIN_VERIFIER_SCHEMA = {
  name: 'linkedin_tool_verification',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string' as const, enum: ['yes', 'no'] },
      reason: { type: 'string' as const },
    },
    required: ['verdict', 'reason'],
    additionalProperties: false,
  },
};

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, '');
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

function isLinkedInProfileUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?linkedin\.com\/in\//i.test(url.trim());
}

function extractParsedObject(raw: ExaSearchResponse): Record<string, unknown> | null {
  const content = raw.output?.content;
  if (content && typeof content === 'object') return content as Record<string, unknown>;
  return null;
}

function buildUrlTextMap(raw: ExaSearchResponse): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of raw.results ?? []) {
    if (r.url && isLinkedInProfileUrl(r.url) && typeof r.text === 'string' && r.text.length > 0) {
      map.set(normalizeUrl(r.url), r.text);
    }
  }
  return map;
}

async function verifyLinkedInProfileTool(
  tool: { name: string; sourceUrl: string },
  pageText: string,
  company: StageCompany
): Promise<{ verified: true } | { verified: false; reason: string }> {
  const result = await openaiLimit(() =>
    withRetry(
      () =>
        judge<{ verdict: 'yes' | 'no'; reason: string }>({
          system: LINKEDIN_VERIFIER_SYSTEM,
          user: JSON.stringify({
            targetCompany: { name: company.companyName, domain: company.domain },
            tool: tool.name,
            pageUrl: tool.sourceUrl,
            pageText: pageText.slice(0, 100000),
          }),
          schema: LINKEDIN_VERIFIER_SCHEMA,
        }),
      { tries: 3, baseMs: 1000, label: `linkedinVerify:${company.domain}:${tool.name}` }
    )
  );
  if (result.verdict === 'yes') return { verified: true };
  return { verified: false, reason: `openai verdict=no: ${result.reason}` };
}

function cleanName(raw: string): string {
  let s = raw
    .replace(/^[\s\-*•]+/, '')
    .replace(/[\s:\-–—]+$/, '')
    .replace(/^\*+|\*+$/g, '')
    .trim();
  s = s.replace(/^\[(.*)\]$/, '$1');
  s = s.replace(/^\((.*)\)$/, '$1');
  s = s.replace(/^(["'`])(.*)\1$/, '$2');
  return s.trim();
}

function parseToolsText(
  toolsText: string,
  domain: string
): Array<{ name: string; sourceUrl: string }> {
  const tools: Array<{ name: string; sourceUrl: string }> = [];
  const dropped: Array<{ line: string; reason: string }> = [];
  const lines = toolsText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const urlMatch = line.match(/https?:\/\/[^\s<>"'`)\]]+/i);
    if (!urlMatch) {
      dropped.push({ line, reason: 'no http(s) URL found' });
      continue;
    }
    const sourceUrl = urlMatch[0].replace(/[.,;:!?)\]>]+$/, '');

    if (sourceUrl.toLowerCase().endsWith('.html')) {
      dropped.push({ line, reason: '.html URL ignored' });
      continue;
    }

    const before = line.slice(0, line.indexOf(urlMatch[0]));
    const colonIdx = before.indexOf(':');
    const nameCandidate = colonIdx > 0 ? before.slice(0, colonIdx) : before;
    const name = cleanName(nameCandidate);
    if (!name) {
      dropped.push({ line, reason: 'no tool name before URL' });
      continue;
    }

    tools.push({ name, sourceUrl });
  }

  if (toolsText.trim().length > 0 && tools.length === 0) {
    console.log(`[observabilityTool] ${domain}: toolsText non-empty but 0 tools parsed. Raw toolsText:`);
    console.log(toolsText);
    for (const d of dropped) console.log(`  dropped "${d.line}" — ${d.reason}`);
  }

  const priority: typeof tools = [];
  const rest: typeof tools = [];
  for (const t of tools) {
    if (ALLOWLIST.has(t.name.toLowerCase())) priority.push(t);
    else rest.push(t);
  }
  return [...priority, ...rest];
}

async function fetchTheirStackTools(
  domain: string,
  slugs: readonly string[]
): Promise<Array<{ name: string; sourceUrl: string }>> {
  const res = await scheduleTheirstack(() => theirstackJobsByAnySlugs(domain, [...slugs]));
  const job = res.data?.[0];
  if (!job) return [];
  const techSlugs = job.technology_slugs ?? [];
  const sourceUrl = collectJobUrls(job);
  if (!sourceUrl) return [];
  return slugs
    .filter((s) => techSlugs.includes(s))
    .map((s) => ({ name: SLUG_DISPLAY[s] ?? s, sourceUrl }));
}

export async function parseObservabilityToolResponse(
  raw: ExaSearchResponse,
  companies: StageCompany[]
): Promise<StageResult<ObservabilityToolData>[]> {
  console.log('[observabilityTool] raw Exa output.content:', JSON.stringify(raw.output?.content, null, 2));
  console.log('[observabilityTool] raw Exa results[] URLs + hasText:', (raw.results ?? []).map(r => ({ url: r.url, hasText: typeof r.text === 'string' && r.text.length > 0, textLen: r.text?.length ?? 0 })));

  const parsedMap = new Map<string, ObservabilityToolData>();
  const payload = extractParsedObject(raw);
  const items = Array.isArray(payload?.['companies']) ? (payload!['companies'] as unknown[]) : [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const domainRaw = typeof rec['domain'] === 'string' ? rec['domain'] : '';
    if (!domainRaw) continue;
    if (typeof rec['toolsText'] !== 'string') continue;

    const normalizedDomain = normalizeDomain(domainRaw);
    const tools = parseToolsText(rec['toolsText'], normalizedDomain);
    parsedMap.set(normalizedDomain, { tools });
  }

  const urlTextMap = buildUrlTextMap(raw);

  const results = await Promise.all(
    companies.map(async (company) => {
      const data = parsedMap.get(company.domain);
      if (!data) return { company, error: 'no output from Exa' };

      const verified: Array<{ name: string; sourceUrl: string }> = [];
      const dropped: Array<{ tool: { name: string; sourceUrl: string }; reason: string }> = [];

      await Promise.all(
        data.tools.map(async (tool) => {
          if (!isLinkedInProfileUrl(tool.sourceUrl)) {
            verified.push(tool);
            return;
          }
          const pageText = urlTextMap.get(normalizeUrl(tool.sourceUrl));
          if (!pageText) {
            dropped.push({ tool, reason: 'linkedin profile not in results[] — cannot verify' });
            return;
          }
          const v = await verifyLinkedInProfileTool(tool, pageText, company);
          if (v.verified) verified.push(tool);
          else dropped.push({ tool, reason: v.reason });
        })
      );

      if (dropped.length > 0) {
        console.log(`[observabilityTool] ${company.domain}: ${dropped.length} linkedin profile tool(s) dropped`);
        for (const d of dropped) {
          console.log(`  ✗ ${d.tool.name} → ${d.tool.sourceUrl} — ${d.reason}`);
        }
      }

      const hasAllowlist = verified.some((t) => ALLOWLIST.has(t.name.toLowerCase()));
      const hasOtherTools = verified.length > 0 && !hasAllowlist;

      if (!hasAllowlist) {
        const gateTs = await fetchTheirStackTools(company.domain, THEIRSTACK_GATE_SLUGS);
        if (gateTs.length > 0) {
          console.log(`[observabilityTool] ${company.domain}: TheirStack gate call found ${gateTs.map((t) => t.name).join(', ')}`);
          verified.push(...gateTs);
        } else if (!hasOtherTools) {
          const otherTs = await fetchTheirStackTools(company.domain, THEIRSTACK_OTHER_SLUGS);
          if (otherTs.length > 0) {
            console.log(`[observabilityTool] ${company.domain}: TheirStack other call found ${otherTs.map((t) => t.name).join(', ')}`);
            verified.push(...otherTs);
          }
        }
      }

      return { company, data: { tools: verified } };
    })
  );

  for (const r of results) {
    if (r.error !== undefined) continue;
    if (r.data.tools.length === 0) {
      console.log(`[observabilityTool] ${r.company.domain}: 0 tools (no evidence)`);
    } else {
      console.log(`[observabilityTool] ${r.company.domain}: ${r.data.tools.length} tool(s)`);
      for (const t of r.data.tools) console.log(`  • ${t.name} → ${t.sourceUrl}`);
    }
  }

  const missing = results.filter((r) => r.error !== undefined).map((r) => r.company.domain);
  if (missing.length > 0) {
    console.log(
      `[observabilityTool] parse miss — expected=[${companies.map((c) => c.domain).join(', ')}] parsed=[${[...parsedMap.keys()].join(', ')}] missing=[${missing.join(', ')}]`
    );

  }

  return results;
}

export const observabilityToolGate: GateRule<ObservabilityToolData> = (d) => {
  if (d.tools.length === 0) return true;
  return d.tools.some((t) => ALLOWLIST.has(t.name.toLowerCase()));
};

export function formatObservabilityToolForAttio(d: ObservabilityToolData): string {
  if (d.tools.length === 0) return 'No evidence found';
  return d.tools.map((t) => `${t.name}: ${t.sourceUrl}`).join('\n');
}

export const observabilityToolCacheGate = (cached: string): boolean => {
  const trimmed = cached.trim();
  if (!trimmed) return false;
  if (trimmed === 'No evidence found') return true;
  const toolNames = trimmed
    .split('\n')
    .map((line) => line.split(':')[0]?.trim().toLowerCase() ?? '')
    .filter(Boolean);
  if (toolNames.length === 0) return false;
  return toolNames.some((name) => ALLOWLIST.has(name));
};
