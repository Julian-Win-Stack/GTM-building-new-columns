export type InputRow = {
  'Company Name': string;
  'Website': string;
  'LinkedIn URL': string;
};

export type Status = 'done' | 'error' | 'processing' | 'pending';

export type OutputRow = {
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
  'Status': Status | '';
  'Last Attempt': string;
  'Error': string;
};
