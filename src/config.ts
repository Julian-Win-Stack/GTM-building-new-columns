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
  azureOpenAIDeploymentPro: process.env.AZURE_OPENAI_DEPLOYMENT_PRO ?? '',
  attio: process.env.ATTIO_API_KEY ?? '',
  attioObjectSlug: process.env.ATTIO_OBJECT_SLUG ?? 'ranked_companies',
  apollo: process.env.APOLLO_API_KEY ?? '',
  xApi: process.env.X_API_KEY ?? '',
} as const;

export const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);

export const EXA_QPS = Number(process.env.EXA_QPS ?? 5);
export const EXA_RETRY_TRIES = Number(process.env.EXA_RETRY_TRIES ?? 3);
export const EXA_RETRY_BASE_MS = Number(process.env.EXA_RETRY_BASE_MS ?? 1000);
export const ATTIO_WRITE_CONCURRENCY = Number(process.env.ATTIO_WRITE_CONCURRENCY ?? 5);
export const OPENAI_CONCURRENCY = Number(process.env.OPENAI_CONCURRENCY ?? 5);
export const THEIRSTACK_QPS = Number(process.env.THEIRSTACK_QPS ?? 3.5);
export const THEIRSTACK_RETRY_TRIES = Number(process.env.THEIRSTACK_RETRY_TRIES ?? 3);
export const THEIRSTACK_RETRY_BASE_MS = Number(process.env.THEIRSTACK_RETRY_BASE_MS ?? 1000);
export const APOLLO_QPS = Number(process.env.APOLLO_QPS ?? 3);
export const APOLLO_RETRY_TRIES = Number(process.env.APOLLO_RETRY_TRIES ?? 3);
export const APOLLO_RETRY_BASE_MS = Number(process.env.APOLLO_RETRY_BASE_MS ?? 1000);
export const APIFY_CONCURRENCY = Number(process.env.APIFY_CONCURRENCY ?? 10);
export const APIFY_RETRY_TRIES = Number(process.env.APIFY_RETRY_TRIES ?? 3);
export const APIFY_RETRY_BASE_MS = Number(process.env.APIFY_RETRY_BASE_MS ?? 2000);
export const TWITTER_API_QPS = Number(process.env.TWITTER_API_QPS ?? 19);
export const TWITTER_API_RETRY_TRIES = Number(process.env.TWITTER_API_RETRY_TRIES ?? 3);
export const TWITTER_API_RETRY_BASE_MS = Number(process.env.TWITTER_API_RETRY_BASE_MS ?? 1000);
export const STATUSPAGE_CONCURRENCY = Number(process.env.STATUSPAGE_CONCURRENCY ?? 20);
export const STATUSPAGE_RETRY_TRIES = Number(process.env.STATUSPAGE_RETRY_TRIES ?? 3);
export const STATUSPAGE_RETRY_BASE_MS = Number(process.env.STATUSPAGE_RETRY_BASE_MS ?? 1000);

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
  'Industry',
  'Company Context Score',
  'Tooling Match Score',
  'Intent Signal Score',
  'Final Score',
] as const;
