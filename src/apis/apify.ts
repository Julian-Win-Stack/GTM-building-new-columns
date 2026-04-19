import { ApifyClient } from 'apify-client';
import { KEYS } from '../config.js';

const client = new ApifyClient({ token: KEYS.apify });

export type HarvestEmployeeItem = Record<string, unknown>;
export type HarvestEmployeesResponse = { items: HarvestEmployeeItem[] };

export async function runHarvestLinkedInEmployees(
  linkedinUrl: string,
  jobTitles: string[]
): Promise<HarvestEmployeesResponse> {
  const run = await client.actor('harvestapi/linkedin-company-employees').call({
    companies: [linkedinUrl],
    excludeSeniorityLevelIds: ['310', '320'],
    jobTitles,
    maxItems: 20,
    profileScraperMode: 'Short ($4 per 1k)',
    recentlyChangedJobs: false,
  });
  if (run.statusMessage === 'rate limited') {
    throw new Error('Apify/LinkedIn rate limit hit — cell left blank for retry on next run');
  }
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return { items: items as HarvestEmployeeItem[] };
}
