import axios from 'axios';
import { KEYS } from '../config.js';

const http = axios.create({
  baseURL: 'https://api.exa.ai',
  headers: { 'x-api-key': KEYS.exa, 'content-type': 'application/json' },
  timeout: 60_000,
});

export async function exaSearch({ query, numResults = 5, useAutoprompt = true, type = 'auto', includeDomains, excludeDomains, contents }) {
  const { data } = await http.post('/search', {
    query,
    numResults,
    useAutoprompt,
    type,
    ...(includeDomains ? { includeDomains } : {}),
    ...(excludeDomains ? { excludeDomains } : {}),
    ...(contents ? { contents } : {}),
  });
  return data;
}
