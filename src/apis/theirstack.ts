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
