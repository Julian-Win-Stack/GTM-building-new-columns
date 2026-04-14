import { ApifyClient } from 'apify-client';
import { KEYS } from '../config.js';

const client = new ApifyClient({ token: KEYS.apify });

export async function findPeopleLinkedInUrls(company) {
  // TODO: replace with the actual Apify actor id + input shape
  // const run = await client.actor('<actor-id>').call({ ... });
  // return (await client.dataset(run.defaultDatasetId).listItems()).items;
  return [];
}

export async function fetchLinkedInPosts(criteria) {
  // TODO: replace with the actual Apify actor id + input shape
  // const run = await client.actor('<actor-id>').call({ ... });
  // return (await client.dataset(run.defaultDatasetId).listItems()).items;
  return [];
}
