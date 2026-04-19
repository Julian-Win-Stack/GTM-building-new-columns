import axios from 'axios';
import { KEYS } from '../config.js';

const http = axios.create({
  baseURL: 'https://api.apollo.io/api/v1',
  headers: { 'x-api-key': KEYS.apollo, 'content-type': 'application/json' },
  timeout: 60_000,
});

export type ApolloApiSearchResponse = {
  total_entries: number;
};

export async function apolloMixedPeopleApiSearch(domain: string, titles: readonly string[]): Promise<ApolloApiSearchResponse> {
  const { data } = await http.post<ApolloApiSearchResponse>('/mixed_people/api_search', {
    q_organization_domains_list: [domain],
    person_titles: titles,
    per_page: 1,
    page: 1,
  });
  return data;
}
