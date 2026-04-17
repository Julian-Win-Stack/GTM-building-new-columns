import axios from 'axios';
import { KEYS } from '../config.js';
import type { AttioRecord, EnrichmentResult } from '../types.js';

// TODO: once Attio access is granted, replace these with the real object slug + field slugs
//       from the Attio workspace (Developer → Attributes).
const ATTIO_OBJECT = 'companies';

const FIELD_SLUGS: Record<string, string> = {
  'Company Name': 'name',
  'Domain': 'domains',
  'Digital-native (Exa)': 'digital_native_exa',
  'Cloud Tool (Exa)': 'cloud_tool_exa',
  'Observability Tool': 'observability_tool',
  'Communication Tool (Exa)': 'communication_tool_exa',
  'Number of Users': 'number_of_users',
  'Competitor Tooling': 'competitor_tooling',
  'Engineer Hiring': 'engineer_hiring',
  'SRE Hiring': 'sre_hiring',
  'Recent Incidents': 'recent_incidents',
  'Funding Growth': 'funding_growth',
  'Revenue Growth': 'revenue_growth',
  'AI-forward Organization': 'ai_forward_organization',
  'AI Reliability Keyword Signals': 'ai_reliability_keyword_signals',
  'Status': 'enrichment_status',
  'Last Attempt': 'enrichment_last_attempt',
  'Error': 'enrichment_error',
};

const http = axios.create({
  baseURL: 'https://api.attio.com/v2',
  headers: { Authorization: `Bearer ${KEYS.attio}`, 'content-type': 'application/json' },
  timeout: 60_000,
});

function toAttioValues(data: Partial<EnrichmentResult>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(data)) {
    const slug = FIELD_SLUGS[col];
    if (!slug || val === undefined || val === '') continue;
    values[slug] = val;
  }
  return values;
}

/**
 * Look up a company in Attio by domain. Returns null if not found.
 */
export async function findCompanyByDomain(_domain: string): Promise<AttioRecord | null> {
  // TODO: implement once Attio access is available.
  // POST /v2/objects/{ATTIO_OBJECT}/records/query
  //   body: { filter: { domains: { $contains: domain } }, limit: 1 }
  void http;
  console.log(`[attio:stub] findCompanyByDomain(${_domain})`);
  return null;
}

/**
 * Create a new company record in Attio with the enrichment results.
 */
export async function createCompany(data: Partial<EnrichmentResult>): Promise<AttioRecord> {
  const values = toAttioValues(data);
  // TODO: implement once Attio access is available.
  // POST /v2/objects/{ATTIO_OBJECT}/records
  //   body: { data: { values } }
  console.log(`[attio:stub] createCompany`, values);
  return { id: 'stub-id', values: {} };
}

/**
 * Update an existing Attio record. Only sends fields with non-empty values.
 */
export async function updateCompany(recordId: string, data: Partial<EnrichmentResult>): Promise<void> {
  const values = toAttioValues(data);
  // TODO: implement once Attio access is available.
  // PATCH /v2/objects/{ATTIO_OBJECT}/records/{recordId}
  //   body: { data: { values } }
  console.log(`[attio:stub] updateCompany(${recordId})`, values);
}

/**
 * Returns the set of enrichable columns that are currently empty on an Attio record.
 * Used by enrich-all to fill only missing gaps without overwriting manual edits.
 */
export function findEmptyColumns(record: AttioRecord): string[] {
  const empty: string[] = [];
  for (const col of Object.keys(FIELD_SLUGS)) {
    const v = record.values[col as keyof typeof record.values];
    if (v === undefined || v === '') empty.push(col);
  }
  return empty;
}
