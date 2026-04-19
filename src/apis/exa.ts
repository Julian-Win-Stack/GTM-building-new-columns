import Exa from 'exa-js';
import { KEYS } from '../config.js';

export type DigitalNativeExaItem = {
  domain: string;
  category: string;
  confidence: string;
  reason: string;
};

export type ObservabilityToolItem = { name: string; sourceUrl: string };
export type ObservabilityToolPayload = {
  companies: Array<{ domain: string; toolsText: string }>;
};

export type DigitalNativeExaPayload = {
  companies: DigitalNativeExaItem[];
};

export type ExaSearchResponse = {
  results: Array<{
    id: string;
    url: string;
    title: string;
    text?: string;
    highlights?: string[];
    highlightScores?: number[];
    publishedDate?: string;
    author?: string;
    image?: string;
    favicon?: string;
  }>;
  searchTime: number;
  output: {
    content: string | Record<string, unknown>;
    grounding: Array<{
      field: string;
      citations: Array<{ url: string; title: string }>;
      confidence: string;
    }>;
  };
  costDollars: { total: number };
};

const exa = new Exa(KEYS.exa);

const SYSTEM_PROMPT = `You are a strict business model classification system.

Your task is to classify a company into EXACTLY ONE of the following categories based on its PRIMARY revenue-generating business model:

CATEGORIES:
1. Digital-native B2C        — Sells and delivers directly to individual consumers via a digital product. The consumer is both the buyer and the user.
2. Digital-native B2B        — Sells software or digital services to businesses. The business is both the buyer AND the primary end-user of the product. Consumers (if any) interact with the business, not the vendor's platform.
3. Digital-native B2B2C      — Sells a digital platform to businesses, which then deploy that platform to serve their own end consumers. The vendor's product (or brand) may be white-labeled, but the platform's PRIMARY OUTPUT is a consumer-facing experience, and consumer data or behavior is core to the product's value proposition.
4. Digital-native B2C2B      — Acquires individual consumers or prosumers first via a free or low-cost digital product, then monetizes by selling to the businesses or employers those individuals belong to.
5. NOT Digital-native        — Physical-first or traditional businesses where software/internet is a supporting tool, not the core product experience.

KEY DISTINCTIONS (resolve ambiguity by applying these rules in order):

Rule 1 — Is the core product digital?
   If the company's primary value is delivered through physical goods, in-person services, or manual labor (even if supported by an app or website), classify as NOT Digital-native.

Rule 2 — Who is the daily end-user of the software?
   If the business customer's own employees are the primary daily users of the platform (e.g., recruiters using a CRM, HR teams using an HRIS, finance teams using ERP), classify as B2B — not B2B2C.
   B2B2C requires the vendor's platform to pass THROUGH the business customer to reach a separate, external end-consumer population.

Rule 2b — What is the intended PRIMARY OUTPUT of the platform?
   If the platform's primary output is internal business efficiency (e.g., CRM, ATS, ERP, analytics dashboards for internal teams), classify as B2B.
   If the platform's primary output is a consumer-facing experience (e.g., loyalty programs, customer engagement tools, consumer apps, personalized offers) — even if white-labeled and even if internal teams configure it — classify as B2B2C, especially if consumer data and consumer behavior are core to the product's value proposition.

Rule 3 — Is the vendor's brand visible to end consumers?
   In true B2B2C, the end consumer may or may not know they are using the vendor's underlying platform — white-labeling does not disqualify B2B2C classification.
   If the vendor is entirely invisible AND the platform's output is internal-only (back-office), classify as B2B.
   Use this rule as a supporting signal, not the sole deciding factor.

Rule 4 — Consumer acquisition before monetization?
   If the company first built a free or low-cost consumer base, then later sold access, data, or analytics to businesses, classify as B2C2B.

TIEBREAKER — When rules conflict:
   Ask: "If you removed the end consumer entirely, would the product still have its core value?"
   - If YES (e.g., a CRM still helps recruiters manage pipelines without candidates) → B2B.
   - If NO (e.g., a loyalty platform has no purpose without consumers earning and redeeming rewards) → B2B2C.

RESEARCH STEPS:
1. Visit the company's homepage, About page, and primary product pages.
2. Identify: What is the core product? Who pays for it? Who uses it daily?
3. Ask: Does the paying business use the product internally for operational efficiency, or does it deploy the product outward to shape a consumer experience?
4. Ask: Is consumer data, behavior, or engagement the central value the platform delivers — even if businesses configure it?
5. Ask: Is the vendor's brand or interface visible to end consumers? (Supporting signal only.)
6. Ask: Did consumer adoption precede business monetization?
7. Apply Rules 1 → 2 → 2b → 3 → 4 → Tiebreaker in order and select ONE category.

For each input company domain, return one object in the "companies" array with:
   - domain: the exact domain provided (lowercase, no www.)
   - category: one of the five categories above
   - confidence: High | Medium | Low
   - reason: 2–3 sentences referencing specific product behavior — who uses it daily, what the platform outputs, and whether consumers are the core value driver. Do not rely solely on company descriptions or marketing language.

Always include every requested domain in the companies array, even if confidence is Low.`;

const DIGITAL_NATIVE_OBJECT_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          category: {
            type: 'string',
            enum: [
              'Digital-native B2C',
              'Digital-native B2B',
              'Digital-native B2B2C',
              'Digital-native B2C2B',
              'NOT Digital-native',
            ],
          },
          confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          reason: { type: 'string' },
        },
        required: ['domain', 'category', 'confidence', 'reason'],
      },
    },
  },
  required: ['companies'],
} as const;

export async function digitalNativeExaSearch(domains: string[]): Promise<ExaSearchResponse> {
  if (domains.length === 0) throw new Error('digitalNativeExaSearch: need at least 1 domain');

  const query =
    domains.length === 1
      ? `Research for ${domains[0]}`
      : `Research for ${domains.slice(0, -1).join(', ')} and ${domains[domains.length - 1]}`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    numResults: 10,
    outputSchema: DIGITAL_NATIVE_OBJECT_SCHEMA,
    stream: false,
    systemPrompt: SYSTEM_PROMPT,
    type: 'deep-reasoning',
  });
}

const SYSTEM_PROMPT_OBSERVABILITY = `Determine which of the following observability tools are used by each target company. Report evidence ONLY for tools on the ALLOWED TOOLS list below — do NOT report any other tools, platforms, or services.

ALLOWED TOOLS (closed list — only these tools may be reported, spelled exactly as shown):
- Datadog
- Grafana
- New Relic
- Dynatrace
- Chronosphere
- Coralogix
- Elastic (ELK)
- Honeycomb
- Sentry
- Axiom
- VictoriaMetrics
- Kibana
- Netdata
- Perses
- Prometheus

Search strategy:
- Check the official customer / case-study pages of vendors from the ALLOWED TOOLS list for the target company
- Review job postings (software engineer, infrastructure, platform, SRE, backend, etc.) for mentions of tools from the ALLOWED TOOLS list
- Look for technical blogs or engineering posts by the company or its employees
- Search LinkedIn profiles and activity (posts/comments) of current employees for mentions of tools from the ALLOWED TOOLS list used in their daily work

Rules:
- Only report a tool if it is on the ALLOWED TOOLS list AND there is direct evidence with a source link — no guessing or inference
- Do NOT include tools outside the ALLOWED TOOLS list, even if the company clearly uses them (e.g., Splunk, AppDynamics, AWS CloudWatch, Elasticsearch-without-ELK, in-house / proprietary tooling — all excluded)
- Do NOT include in-house, custom, or proprietary tools
- If no valid evidence for an ALLOWED TOOL is found for a company, return an empty toolsText "" for that company

Source requirements:
- Do NOT return any links ending in .html
- Ignore all sources where the URL ends in .html

LinkedIn-specific rules:
- Ensure the observability tool is mentioned under the target company's experience block on the profile
- Ignore mentions tied to other companies listed on the same profile

For each input domain, return exactly one entry in companies[] with:
- domain: the exact domain provided (lowercase, no www.)
- toolsText: a newline-separated list where each line is formatted EXACTLY as "ToolName: SourceUrl" (one tool per line). ToolName MUST be one of the ALLOWED TOOLS above, spelled exactly as listed (e.g., "New Relic" with a space, "Elastic (ELK)" with parentheses). If no evidence is found, return an empty string "". Do NOT include any other text, headers, numbering, or bullet markers in toolsText — only "Name: URL" lines separated by "\n".

Example toolsText for a company with two tools:
Datadog: https://jobs.ashbyhq.com/example/abc
Grafana: https://www.linkedin.com/in/someone

Always include every requested domain in the companies array, even if toolsText is "".`;

const OBSERVABILITY_TOOL_OBJECT_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          toolsText: { type: 'string' },
        },
        required: ['domain', 'toolsText'],
      },
    },
  },
  required: ['companies'],
} as const;

export async function observabilityToolExaSearch(domains: string[]): Promise<ExaSearchResponse> {
  if (domains.length === 0) throw new Error('observabilityToolExaSearch: need at least 1 domain');

  const query = `What observability tools do these companies use?\n${domains.join('\n')}`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    numResults: 10,
    outputSchema: OBSERVABILITY_TOOL_OBJECT_SCHEMA,
    stream: false,
    systemPrompt: SYSTEM_PROMPT_OBSERVABILITY,
    type: 'deep-reasoning',
    contents: {
      text: { maxCharacters: 100000 },
    },
  });
}
