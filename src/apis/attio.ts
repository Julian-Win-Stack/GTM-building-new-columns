import axios from 'axios';
import { KEYS } from '../config.js';
import type { AttioRecord, EnrichmentResult } from '../types.js';

export const FIELD_SLUGS: Record<string, string> = {
  'Company Name': 'company_name',
  'Domain': 'domain',
  'LinkedIn Page': 'linkedin_page',
  'Digital Native': 'digital_native',
  'Cloud Tool': 'cloud_tool',
  'Observability Tool': 'observability_tool',
  'Communication Tool': 'communication_tool',
  'Number of Users': 'number_of_users',
  'Competitor Tooling': 'competitor_tooling',
  'Number of Engineers': 'number_of_engineers',
  'Number of SREs': 'number_of_sres',
  'Engineer Hiring': 'engineer_hiring',
  'SRE Hiring': 'sre_hiring',
  'Customer complains on X': 'customer_complains_on_x',
  'Recent incidents ( Official )': 'recent_incidents_official',
  'Funding Growth': 'funding_growth',
  'Revenue Growth': 'revenue_growth',
  'AI adoption mindset': 'ai_adoption_mindset',
  'AI SRE maturity': 'ai_sre_maturity',
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

type RawAttioField = Array<{ value?: string; domain_name?: string }>;
type RawAttioRecord = { id: { record_id: string } | string; values: Record<string, RawAttioField> };

function extractDomain(rec: RawAttioRecord): string {
  const arr = rec.values?.['domain'];
  return arr?.[0]?.domain_name ?? arr?.[0]?.value ?? '';
}

function extractValues(rec: RawAttioRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slug, arr] of Object.entries(rec.values ?? {})) {
    const val = arr?.[0]?.value ?? arr?.[0]?.domain_name ?? '';
    if (val) out[slug] = val;
  }
  return out;
}

export async function fetchAllRecords(
  domains: string[],
  client: { post: typeof http.post } = http
): Promise<Map<string, Record<string, string>>> {
  const domainSet = new Set(domains);
  const map = new Map<string, Record<string, string>>();
  let offset = 0;
  const limit = 500;

  while (true) {
    const res = await client.post(`/objects/${KEYS.attioObjectSlug}/records/query`, { limit, offset });
    const records = (res.data?.data ?? []) as RawAttioRecord[];
    if (records.length === 0) break;

    for (const rec of records) {
      const domain = extractDomain(rec);
      if (domain && domainSet.has(domain)) {
        map.set(domain, extractValues(rec));
      }
    }

    if (records.length < limit) break;
    offset += limit;
  }

  return map;
}

export async function findCompanyByDomain(domain: string): Promise<AttioRecord | null> {
  const res = await http.post(`/objects/${KEYS.attioObjectSlug}/records/query`, {
    filter: { domain: { $eq: domain } },
    limit: 1,
  });
  const rec = res.data?.data?.[0];
  return rec ? { id: rec.id?.record_id ?? rec.id, values: rec.values ?? {} } : null;
}

export async function createCompany(data: Partial<EnrichmentResult>): Promise<AttioRecord> {
  const values = toAttioValues(data);
  const res = await http.post(`/objects/${KEYS.attioObjectSlug}/records`, { data: { values } });
  const rec = res.data?.data;
  return { id: rec.id?.record_id ?? rec.id, values: rec.values ?? {} };
}

export async function updateCompany(recordId: string, data: Partial<EnrichmentResult>): Promise<void> {
  const values = toAttioValues(data);
  await http.patch(`/objects/${KEYS.attioObjectSlug}/records/${recordId}`, { data: { values } });
}

export async function upsertCompanyByDomain(data: Partial<EnrichmentResult>): Promise<AttioRecord> {
  const values = toAttioValues(data);
  const res = await http.put(
    `/objects/${KEYS.attioObjectSlug}/records`,
    { data: { values } },
    { params: { matching_attribute: 'domain' } }
  );
  const rec = res.data?.data;
  return { id: rec.id?.record_id ?? rec.id, values: rec.values ?? {} };
}
