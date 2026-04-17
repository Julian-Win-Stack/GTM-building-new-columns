import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const PATHS = {
  defaultInputCsv: path.join(ROOT, 'data', 'input.csv'),
  cache: path.join(ROOT, 'cache'),
} as const;

export const KEYS = {
  apify: process.env.APIFY_TOKEN ?? '',
  exa: process.env.EXA_API_KEY ?? '',
  theirstack: process.env.THEIRSTACK_API_KEY ?? '',
  azureOpenAIKey: process.env.AZURE_OPENAI_API_KEY ?? '',
  azureOpenAIBaseUrl: process.env.AZURE_OPENAI_BASE_URL ?? '',
  azureOpenAIDeployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? '',
  attio: process.env.ATTIO_API_KEY ?? '',
  attioObjectSlug: process.env.ATTIO_OBJECT_SLUG ?? 'ranked_companies',
} as const;

export const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);

export const INPUT_COLUMNS = ['Company Name', 'Website', 'Company Linkedin Url'] as const;

export const ENRICHABLE_COLUMNS = [
  'Digital Native',
  'Cloud Tool',
  'Observability Tool',
  'Communication Tool',
  'Number of Users',
  'Competitor Tooling',
  'Number of Engineers',
  'Number of SREs',
  'Engineer Hiring',
  'SRE Hiring',
  'Customer complains on X',
  'Recent incidents ( Official )',
  'Funding Growth',
  'Revenue Growth',
  'AI adoption mindset',
  'AI SRE maturity',
] as const;
