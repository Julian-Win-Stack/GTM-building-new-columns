import { deriveDomain, nowIso } from './util.js';
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

/**
 * Run every enricher for a company and return a full EnrichmentResult.
 * If `onlyColumns` is provided, runs only those enrichers (others are left blank).
 */
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
    'Digital-native (Exa)': values['Digital-native (Exa)'] ?? '',
    'Cloud Tool (Exa)': values['Cloud Tool (Exa)'] ?? '',
    'Observability Tool': values['Observability Tool'] ?? '',
    'Communication Tool (Exa)': values['Communication Tool (Exa)'] ?? '',
    'Number of Users': values['Number of Users'] ?? '',
    'Competitor Tooling': values['Competitor Tooling'] ?? '',
    'Engineer Hiring': values['Engineer Hiring'] ?? '',
    'SRE Hiring': values['SRE Hiring'] ?? '',
    'Recent Incidents': values['Recent Incidents'] ?? '',
    'Funding Growth': values['Funding Growth'] ?? '',
    'Revenue Growth': values['Revenue Growth'] ?? '',
    'AI-forward Organization': values['AI-forward Organization'] ?? '',
    'AI Reliability Keyword Signals': values['AI Reliability Keyword Signals'] ?? '',
    'Status': 'done',
    'Last Attempt': nowIso(),
    'Error': '',
  };
  return result;
}

/**
 * Run a single enricher for a single column. Used by `enrich-column`.
 */
export async function runSingleEnricher(row: InputRow, column: EnrichableColumn): Promise<string> {
  const input = toEnricherInput(row);
  return ENRICHERS[column](input);
}
