import axios from 'axios';
import { scheduleStatuspage } from '../rateLimit.js';

const http = axios.create({
  timeout: 15_000,
  validateStatus: () => true,
});

export type StatuspageIncident = {
  impact: 'critical' | 'major' | 'minor' | 'none';
  name: string;
  created_at: string;
  components?: { name: string }[];
};

export type FetchOutcome =
  | { kind: 'ok'; incidents: StatuspageIncident[] }
  | { kind: 'private' }
  | { kind: 'notFound' };

const NINETY_DAYS_MS = 90 * 86400 * 1000;
const MAX_PAGES = 10;

const LEGAL_SUFFIX_RE =
  /(,?\s+(inc|incorporated|llc|l\.l\.c\.|ltd|limited|corp|corporation|co|company|gmbh|s\.a\.|sa|ag|plc|pty|bv)\.?\s*$)/i;

export function slugCandidates(companyName: string): string[] {
  const trimmed = companyName.trim();
  if (!trimmed) return [];
  let stripped = trimmed;
  for (let i = 0; i < 3; i++) {
    const next = stripped.replace(LEGAL_SUFFIX_RE, '').trim();
    if (next === stripped) break;
    stripped = next;
  }
  const lower = stripped.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]+/g, '');
  const dashed = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const out: string[] = [];
  if (compact) out.push(compact);
  if (dashed && dashed !== compact) out.push(dashed);
  return out;
}

function looksLikeStatuspage(body: unknown): body is { incidents: StatuspageIncident[] } {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { incidents?: unknown }).incidents)
  );
}

async function fetchIncidentsForUrl(
  domain: string,
  baseUrl: string
): Promise<FetchOutcome | 'try-next'> {
  const cutoff = Date.now() - NINETY_DAYS_MS;
  const accumulated: StatuspageIncident[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${baseUrl}/api/v2/incidents.json?limit=100&page=${page}`;
    let status: number;
    let body: unknown;
    try {
      const res = await scheduleStatuspage(() => http.get(url));
      status = res.status;
      body = res.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[statuspage] ${domain} probe: url=${url} network-error: ${msg}`);
      return 'try-next';
    }

    if (page === 1 && status === 401) {
      console.log(`[statuspage] ${domain} probe: url=${url} status=401 outcome=private`);
      return { kind: 'private' };
    }
    if (status !== 200 || !looksLikeStatuspage(body)) {
      const shape = typeof body === 'string' ? `string(${body.length})` : typeof body;
      console.log(`[statuspage] ${domain} probe: url=${url} status=${status} body=${shape} outcome=try-next`);
      return 'try-next';
    }

    const pageIncidents = body.incidents;

    let oldestOnPageMs = Infinity;
    for (const inc of pageIncidents) {
      const t = Date.parse(inc.created_at);
      if (!isNaN(t)) {
        if (t >= cutoff) accumulated.push(inc);
        if (t < oldestOnPageMs) oldestOnPageMs = t;
      }
    }

    console.log(
      `[statuspage] ${domain} probe: url=${url} status=200 page=${page} items=${pageIncidents.length} kept=${accumulated.length}`
    );

    if (pageIncidents.length < 100) break;
    if (oldestOnPageMs < cutoff) break;
  }

  return { kind: 'ok', incidents: accumulated };
}

export async function fetchRecentIncidents(
  domain: string,
  companyName: string
): Promise<FetchOutcome> {
  const attempts: string[] = [`https://status.${domain}`];
  for (const slug of slugCandidates(companyName)) {
    attempts.push(`https://${slug}.statuspage.io`);
  }

  for (const baseUrl of attempts) {
    const outcome = await fetchIncidentsForUrl(domain, baseUrl);
    if (outcome !== 'try-next') return outcome;
  }
  console.log(`[statuspage] ${domain} all probes exhausted — notFound`);
  return { kind: 'notFound' };
}
