import { FIELD_SLUGS } from '../src/apis/attio.js';

export type CsvColumnSpec = {
  display: string;
  slug: string;
};

export const CSV_COLUMN_ORDER: readonly string[] = [
  'Company Name',
  'Reason for Rejection',
  'Final Score',
  'Company Context Score',
  'Tooling Match Score',
  'Intent Signal Score',
  'Digital Native',
  'Website',
  'Industry',
  'Number of Users',
  'Observability Tool',
  'Communication Tool',
  'Cloud Tool',
  'Funding Growth',
  'Revenue Growth',
  'Number of Engineers',
  'Number of SREs',
  'Engineer Hiring',
  'SRE Hiring',
  'Customer complains on X',
  'Recent incidents ( Official )',
  'AI adoption mindset',
  'AI SRE maturity',
  'Competitor Tooling',
  'Domain',
  'Description',
  'LinkedIn Page',
  'Apollo ID',
  'Account Purpose',
  'Company Context Score Change Detection for Developer',
  'Tooling Match Change Detection for Developer',
  'Intent Signal Change Detection for Developer',
  'Final Score Change Detection for Developer',
] as const;

export const CSV_COLUMNS: ReadonlyArray<CsvColumnSpec> = CSV_COLUMN_ORDER.map((display) => {
  const slug = FIELD_SLUGS[display];
  if (!slug) throw new Error(`csvColumns: no Attio slug for "${display}"`);
  return { display, slug };
});

// Categorize columns for the live table presentation. Stage cells get a special "loading"
// state when empty during a run; identity cells are always considered present.
export const STAGE_COLUMNS: ReadonlyArray<string> = [
  'Final Score',
  'Company Context Score',
  'Tooling Match Score',
  'Intent Signal Score',
  'Digital Native',
  'Industry',
  'Number of Users',
  'Observability Tool',
  'Communication Tool',
  'Cloud Tool',
  'Funding Growth',
  'Revenue Growth',
  'Number of Engineers',
  'Number of SREs',
  'Engineer Hiring',
  'SRE Hiring',
  'Customer complains on X',
  'Recent incidents ( Official )',
  'AI adoption mindset',
  'AI SRE maturity',
  'Competitor Tooling',
];

export const IDENTITY_COLUMNS: ReadonlyArray<string> = [
  'Company Name',
  'Domain',
  'Website',
  'Description',
  'LinkedIn Page',
  'Apollo ID',
  'Account Purpose',
];

export const DEVELOPER_COLUMNS: ReadonlyArray<string> = [
  'Company Context Score Change Detection for Developer',
  'Tooling Match Change Detection for Developer',
  'Intent Signal Change Detection for Developer',
  'Final Score Change Detection for Developer',
];
