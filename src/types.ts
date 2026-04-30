export type InputRow = {
  'Company Name': string;
  'Website': string;
  'Company Linkedin Url': string;
  'Short Description': string;
  'Apollo Account Id': string;
};

export type EnrichableColumn =
  | 'Digital Native'
  | 'Cloud Tool'
  | 'Observability Tool'
  | 'Communication Tool'
  | 'Number of Users'
  | 'Competitor Tooling'
  | 'Number of Engineers'
  | 'Number of SREs'
  | 'Engineer Hiring'
  | 'SRE Hiring'
  | 'Customer complains on X'
  | 'Recent incidents ( Official )'
  | 'Funding Growth'
  | 'Revenue Growth'
  | 'AI adoption mindset'
  | 'AI SRE maturity'
  | 'Industry'
  | 'Company Context Score'
  | 'Tooling Match Score'
  | 'Intent Signal Score'
  | 'Final Score'
  | 'Reason for Rejection';

export type EnrichmentResult = {
  'Company Name': string;
  'Domain': string;
  'LinkedIn Page': string;
  'Description': string;
  'Website': string;
  'Account Purpose': string;
  'Apollo ID': string;
  'Digital Native': string;
  'Cloud Tool': string;
  'Observability Tool': string;
  'Communication Tool': string;
  'Number of Users': string;
  'Competitor Tooling': string;
  'Number of Engineers': string;
  'Number of SREs': string;
  'Engineer Hiring': string;
  'SRE Hiring': string;
  'Customer complains on X': string;
  'Recent incidents ( Official )': string;
  'Funding Growth': string;
  'Revenue Growth': string;
  'AI adoption mindset': string;
  'AI SRE maturity': string;
  'Industry': string;
  'Company Context Score': string;
  'Company Context Score Change Detection for Developer': string;
  'Tooling Match Score': string;
  'Tooling Match Change Detection for Developer': string;
  'Intent Signal Score': string;
  'Intent Signal Change Detection for Developer': string;
  'Final Score': string;
  'Final Score Change Detection for Developer': string;
  'Reason for Rejection': string;
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
  values: Partial<Record<EnrichableColumn | 'Company Name' | 'Domain', string>>;
};
