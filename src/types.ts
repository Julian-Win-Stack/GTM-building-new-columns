export type InputRow = {
  'Company Name': string;
  'Website': string;
  'Company Linkedin Url': string;
};

export type Status = 'done' | 'error' | 'processing' | 'pending';

// All columns we write to Attio, minus bookkeeping ones (Status / Last Attempt / Error).
export type EnrichableColumn =
  | 'Digital-native (Exa)'
  | 'Cloud Tool (Exa)'
  | 'Observability Tool'
  | 'Communication Tool (Exa)'
  | 'Number of Users'
  | 'Competitor Tooling'
  | 'Engineer Hiring'
  | 'SRE Hiring'
  | 'Recent Incidents'
  | 'Funding Growth'
  | 'Revenue Growth'
  | 'AI-forward Organization'
  | 'AI Reliability Keyword Signals';

export type EnrichmentResult = {
  'Company Name': string;
  'Domain': string;
  'Digital-native (Exa)': string;
  'Cloud Tool (Exa)': string;
  'Observability Tool': string;
  'Communication Tool (Exa)': string;
  'Number of Users': string;
  'Competitor Tooling': string;
  'Engineer Hiring': string;
  'SRE Hiring': string;
  'Recent Incidents': string;
  'Funding Growth': string;
  'Revenue Growth': string;
  'AI-forward Organization': string;
  'AI Reliability Keyword Signals': string;
  'Status': Status;
  'Last Attempt': string;
  'Error': string;
};

export type EnricherInput = {
  companyName: string;
  domain: string;
  website: string;
  linkedinUrl: string;
};

export type EnricherFn = (input: EnricherInput) => Promise<string>;

export type AttioRecord = {
  id: string;
  values: Partial<Record<EnrichableColumn | 'Company Name' | 'Domain' | 'Status' | 'Last Attempt' | 'Error', string>>;
};
