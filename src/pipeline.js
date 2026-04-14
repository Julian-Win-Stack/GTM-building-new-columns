import { deriveDomain, nowIso } from './util.js';

export async function processCompany(input) {
  const companyName = input['Company Name'];
  const website = input['Website'];
  const linkedinUrl = input['LinkedIn URL'];
  const domain = deriveDomain(website);

  // TODO: wire up the real pipeline once you share per-API details.
  //   1. Apify — people LinkedIn URLs for this company
  //   2. Apify — fetch LinkedIn posts matching criteria
  //   3. Exa — multiple searches (cloud tool, comms tool, digital-native, etc.)
  //   4. TheirStack — hiring signals (2 calls: engineer + SRE)
  //   5. OpenAI — summarize + judge each output column

  return {
    'Company Name': companyName,
    'Domain': domain,
    'Digital-native (Exa)': '',
    'Cloud Tool (Exa)': '',
    'Observability Tool': '',
    'Communication Tool (Exa)': '',
    'Number of Users': '',
    'Competitor Tooling': '',
    'Engineer Hiring': '',
    'SRE Hiring': '',
    'Recent Incidents': '',
    'Funding Growth': '',
    'Revenue Growth': '',
    'AI-forward Organization': '',
    'AI Reliability Keyword Signals': '',
    'Status': 'done',
    'Last Attempt': nowIso(),
    'Error': '',
  };
}
