import { deriveDomain } from './util.js';
import { ENRICHERS, ENRICHABLE_COLUMN_LIST } from './enrichers/index.js';
import type { EnrichableColumn, EnricherInput, EnrichmentResult, InputRow } from './types.js';

function toEnricherInput(row: InputRow): EnricherInput {
  return {
    companyName: row['Company Name'],
    domain: deriveDomain(row['Website']),
    website: row['Website'],
    linkedinUrl: row['Company Linkedin Url'],
  };
}

export async function runPipeline(
  row: InputRow,
  onlyColumns?: EnrichableColumn[]
): Promise<EnrichmentResult> {
  const input = toEnricherInput(row);
  const columns = onlyColumns ?? ENRICHABLE_COLUMN_LIST;

  const values: Partial<Record<EnrichableColumn, string>> = {};
  for (const col of columns) {
    values[col] = await ENRICHERS[col](input);
  }

  const result: EnrichmentResult = {
    'Company Name': row['Company Name'],
    'Domain': input.domain,
    'LinkedIn Page': row['Company Linkedin Url'] ?? '',
    'Digital Native': values['Digital Native'] ?? '',
    'Cloud Tool': values['Cloud Tool'] ?? '',
    'Observability Tool': values['Observability Tool'] ?? '',
    'Communication Tool': values['Communication Tool'] ?? '',
    'Number of Users': values['Number of Users'] ?? '',
    'Competitor Tooling': values['Competitor Tooling'] ?? '',
    'Number of Engineers': values['Number of Engineers'] ?? '',
    'Number of SREs': values['Number of SREs'] ?? '',
    'Engineer Hiring': values['Engineer Hiring'] ?? '',
    'SRE Hiring': values['SRE Hiring'] ?? '',
    'Customer complains on X': values['Customer complains on X'] ?? '',
    'Recent incidents ( Official )': values['Recent incidents ( Official )'] ?? '',
    'Funding Growth': values['Funding Growth'] ?? '',
    'Revenue Growth': values['Revenue Growth'] ?? '',
    'AI adoption mindset': values['AI adoption mindset'] ?? '',
    'AI SRE maturity': values['AI SRE maturity'] ?? '',
    'Industry': values['Industry'] ?? '',
    'Reason for Rejection': values['Reason for Rejection'] ?? '',
  };
  return result;
}

export async function runSingleEnricher(row: InputRow, column: EnrichableColumn): Promise<string> {
  const input = toEnricherInput(row);
  return ENRICHERS[column](input);
}
