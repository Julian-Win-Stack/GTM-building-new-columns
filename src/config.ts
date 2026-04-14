import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const PATHS = {
  input: path.join(ROOT, 'data', 'input.csv'),
  output: path.join(ROOT, 'data', 'output.csv'),
  cache: path.join(ROOT, 'cache'),
} as const;

export const KEYS = {
  apify: process.env.APIFY_TOKEN ?? '',
  exa: process.env.EXA_API_KEY ?? '',
  theirstack: process.env.THEIRSTACK_API_KEY ?? '',
  azureOpenAIKey: process.env.AZURE_OPENAI_API_KEY ?? '',
  azureOpenAIBaseUrl: process.env.AZURE_OPENAI_BASE_URL ?? '',
  azureOpenAIDeployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? '',
} as const;

export const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);

export const INPUT_COLUMNS = ['Company Name', 'Website', 'LinkedIn URL'] as const;

export const OUTPUT_COLUMNS = [
  'Company Name',
  'Domain',
  'Digital-native (Exa)',
  'Cloud Tool (Exa)',
  'Observability Tool',
  'Communication Tool (Exa)',
  'Number of Users',
  'Competitor Tooling',
  'Engineer Hiring',
  'SRE Hiring',
  'Recent Incidents',
  'Funding Growth',
  'Revenue Growth',
  'AI-forward Organization',
  'AI Reliability Keyword Signals',
  'Status',
  'Last Attempt',
  'Error',
] as const;
