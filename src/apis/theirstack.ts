import axios from 'axios';
import { KEYS } from '../config.js';

const http = axios.create({
  baseURL: 'https://api.theirstack.com/v1',
  headers: { Authorization: `Bearer ${KEYS.theirstack}`, 'content-type': 'application/json' },
  timeout: 60_000,
});

export type TheirstackJob = {
  source_url?: string | null;
  url?: string | null;
  final_url?: string | null;
  technology_slugs?: string[];
  technology_names?: string[];
};

export type TheirstackJobsResponse = { data: TheirstackJob[] };

export async function theirstackJobsByTechnology(
  domain: string,
  technologySlug: 'slack' | 'microsoft-teams'
): Promise<TheirstackJobsResponse> {
  const { data } = await http.post<TheirstackJobsResponse>('/jobs/search', {
    limit: 1,
    job_technology_slug_or: [technologySlug],
    company_domain_or: [domain],
  });
  return data;
}

export function collectJobUrls(job: TheirstackJob): string {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const u of [job.source_url, job.url, job.final_url]) {
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }
  return urls.join('\n');
}

export async function theirstackJobsByAnySlugs(
  domain: string,
  slugs: string[]
): Promise<TheirstackJobsResponse> {
  const { data } = await http.post<TheirstackJobsResponse>('/jobs/search', {
    limit: 1,
    job_technology_slug_or: slugs,
    company_domain_or: [domain],
  });
  return data;
}
