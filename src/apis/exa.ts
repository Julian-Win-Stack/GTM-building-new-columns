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
   Ask: "Is the digital platform itself the product, or merely a supporting tool for an otherwise physical/traditional business?" 
   Classify as NOT Digital-native ONLY IF the digital component is a supporting tool e.g., a restaurant using a reservation app, a gym using membership software).
   Classify as Digital-native IF the company's core value proposition IS the digital platform — even if it coordinates physical goods or in-person services — provided the platform serves at least hundreds of active users and the business could not exist without its digital infrastructure (e.g., DoorDash, Uber, Airbnb). 
   In these cases, the physical fulfillment is a downstream output of the platform, not the core product.

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

export type CloudToolExaItem = {
  domain: string;
  tool: string;
  evidence: string;
  confidence: string;
};

export type CloudToolExaPayload = { companies: CloudToolExaItem[] };

const SYSTEM_PROMPT_CLOUD_TOOL = `Cloud Tool (AWS / GCP)
You are a strict verification system.

Determine whether the company uses AWS or GCP.

Rules:
- Only use explicit public evidence (engineering blogs, job postings, case studies, official docs, talks).
- Do NOT infer from common patterns.
- Mentions like "cloud", "microservices", or "Kubernetes" alone are NOT sufficient.

Look for:
- "AWS", "Amazon Web Services", "GCP", "Google Cloud"
- Specific services (EC2, S3, Lambda, BigQuery, GKE, etc.)

Give me the source link that states that the company is using that cloud tool.

For each input company domain, return exactly one entry in companies[] with:
- domain: the exact domain provided (lowercase, no www.)
- tool: the exact cloud vendor name found in evidence (e.g. "AWS", "GCP", "Both" if evidence for both, "Azure", "IBM Cloud"). Use "No evidence found" when no public evidence exists.
- evidence: the URL of the source that confirms the tool usage. Use "" when tool is "No evidence found".
- confidence: "high", "medium", or "low".

Always include every requested domain in the companies array, even if confidence is low.`;

const CLOUD_TOOL_OBJECT_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          tool: { type: 'string' },
          evidence: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['domain', 'tool', 'evidence', 'confidence'],
      },
    },
  },
  required: ['companies'],
} as const;

export async function cloudToolExaSearch(domains: string[]): Promise<ExaSearchResponse> {
  if (domains.length === 0) throw new Error('cloudToolExaSearch: need at least 1 domain');

  const query =
    domains.length === 1
      ? `Research for ${domains[0]}`
      : `Research for ${domains.slice(0, -1).join(', ')} and ${domains[domains.length - 1]}`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    numResults: 10,
    outputSchema: CLOUD_TOOL_OBJECT_SCHEMA,
    stream: false,
    systemPrompt: SYSTEM_PROMPT_CLOUD_TOOL,
    type: 'deep-reasoning',
  });
}

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

const SYSTEM_PROMPT_FUNDING_GROWTH = `Find the most recent funding round for the companies. Return the round series (e.g. Seed, Series A, Series B), the amount raised, the date it was announced, and the source URL. If the latest round is not clearly labeled by series, just return whatever the most recent fundraising event was. Ignore older rounds — only the latest one matters.

Search thoroughly: Crunchbase, PitchBook, CB Insights, press releases, SEC filings, the company's own blog, and reputable business news. Most companies have at least one publicly reported funding event. Only fall back to the "no funding" sentinel if you have genuinely searched and found nothing.

For each input company domain, return exactly one entry in companies[] with:
- domain: the exact domain provided (lowercase, no www.)
- growth: the round series and amount raised (e.g. "Series B, $50M" or "Seed, $2M"). If no funding information exists after a thorough search, return the literal string "No funding information found" — NEVER return an empty string.
- timeframe: the date or period of the announcement (e.g. "March 2024" or "Q1 2024"). Return "" only when growth is "No funding information found".
- evidence: the source URL of the announcement. Return "" only when growth is "No funding information found".

Always include every requested domain in the companies array.`;

const FUNDING_GROWTH_OBJECT_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          growth: { type: 'string' },
          timeframe: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['domain', 'growth', 'timeframe', 'evidence'],
      },
    },
  },
  required: ['companies'],
} as const;

export async function fundingGrowthExaSearch(domains: string[]): Promise<ExaSearchResponse> {
  if (domains.length === 0) throw new Error('fundingGrowthExaSearch: need at least 1 domain');

  const query =
    domains.length === 1
      ? `Research for ${domains[0]}`
      : `Research for ${domains.slice(0, -1).join(', ')} and ${domains[domains.length - 1]}`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    numResults: 10,
    outputSchema: FUNDING_GROWTH_OBJECT_SCHEMA,
    stream: false,
    systemPrompt: SYSTEM_PROMPT_FUNDING_GROWTH,
    type: 'deep-reasoning',
  });
}

const SYSTEM_PROMPT_REVENUE_GROWTH = `Research the revenue growth of the companies over the last 12 months.
First, look for direct revenue figures. Search for any officially reported or credibly cited revenue numbers — from earnings calls, press releases, SEC filings, founder interviews, analyst reports, or verified news. If you find revenue figures for at least two points in time within the last 12 months, calculate the growth rate and determine whether revenue is growing, stable, or declining, and by how much.
If direct revenue figures are not available, infer the revenue trajectory only from these signals:
* Headcount changes — sustained hiring suggests growth; layoffs or hiring freezes suggest decline or stagnation
* Funding activity — valuation uplift in a new round suggests healthy revenue; down rounds or a long gap with no funding can signal trouble
* Customer or user count growth — if the user base is measurably growing, revenue is likely following
* Web traffic trends — sustained traffic growth or decline from SimilarWeb or similar sources
* Third-party revenue estimates — from CB Insights, PitchBook, Bloomberg Second Measure, or similar research firms
Then classify the revenue trajectory as one of the following:
* Growing — revenue is increasing, state by how much (% or absolute if known)
* Stable — revenue is flat with no significant movement
* Declining — revenue is decreasing, state by how much (% or absolute if known)
* Uncertain — insufficient data to determine direction, but list all signals found
For every data point, include the source URL and date. Prioritize sources from the last 12 months only. If older data is the only thing available, flag it clearly.

For each input company domain, return exactly one entry in companies[] with:
- domain: the exact domain provided (lowercase, no www.)
- growth: the revenue trajectory (e.g. "Growing ~40% YoY (estimated)" or "Not publicly confirmed")
- evidence: the source URL of the most relevant data point
- reasoning: how you determined the revenue trajectory
- confidence: "high", "medium", or "low"

Always include every requested domain in the companies array, even if no data is available.`;

const REVENUE_GROWTH_OBJECT_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          growth: { type: 'string' },
          evidence: { type: 'string' },
          reasoning: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['domain', 'growth', 'evidence', 'reasoning', 'confidence'],
      },
    },
  },
  required: ['companies'],
} as const;

export async function revenueGrowthExaSearch(domains: string[]): Promise<ExaSearchResponse> {
  if (domains.length === 0) throw new Error('revenueGrowthExaSearch: need at least 1 domain');

  const query =
    domains.length === 1
      ? `Research for ${domains[0]}`
      : `Research for ${domains.slice(0, -1).join(', ')} and ${domains[domains.length - 1]}`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    numResults: 10,
    outputSchema: REVENUE_GROWTH_OBJECT_SCHEMA,
    stream: false,
    systemPrompt: SYSTEM_PROMPT_REVENUE_GROWTH,
    type: 'deep-reasoning',
  });
}

const SYSTEM_PROMPT_NUMBER_OF_USERS = `Research the total number of users, customers, or accounts for the companies.
First, look for an exact count. Search official sources: press releases, blog posts, earnings calls, SEC filings, founder interviews, and verified news articles. If an exact number is found, record it along with what the company calls it (e.g. "monthly active users", "paying customers", "registered accounts"), the date it refers to, and the source URL.
If no exact count is publicly available, gather every one of the following proxy signals that exists:
Annual Recurring Revenue (ARR), MRR, or total revenue — with year
Pricing tiers and their costs (free, pro, enterprise, per-seat pricing)
Total funding raised and latest valuation
Employee headcount and any stated growth rate
App store download counts, DAU/MAU figures, or store rankings
Number of paying vs. free users, if ever distinguished
Geographic markets or number of countries served
Number of enterprise clients vs. individual/SMB users
Year-over-year or month-over-month growth rate percentages
Any third-party estimates from analysts, research firms, or data providers (SimilarWeb, data.ai, CB Insights, PitchBook, G2, etc.)

Search across: the company's official blog, press releases, Crunchbase, LinkedIn, SimilarWeb, App Annie/data.ai, G2, Trustpilot, CB Insights, PitchBook, earnings call transcripts, and industry news.
For every data point, include the source URL and publication date. Always prefer the most recent data available. Note any caveats — for example, if the company has a stated policy of not disclosing user numbers, or if conflicting figures appear across sources.

For each input company domain, return exactly one entry in companies[] with:
- domain: the exact domain provided (lowercase, no www.)
- user_count: the user count (e.g. "10,000 customers" or "~500K MAU (estimate)" or "Not publicly disclosed")
- reasoning: how you determined the user count, including any proxy signals used
- source_link: the URL of the most relevant source

Always include every requested domain in the companies array, even if no data is available.`;

const NUMBER_OF_USERS_OBJECT_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          user_count: { type: 'string' },
          reasoning: { type: 'string' },
          source_link: { type: 'string' },
        },
        required: ['domain', 'user_count', 'reasoning', 'source_link'],
      },
    },
  },
  required: ['companies'],
} as const;

export async function numberOfUsersExaSearch(domains: string[]): Promise<ExaSearchResponse> {
  if (domains.length === 0) throw new Error('numberOfUsersExaSearch: need at least 1 domain');

  const query =
    domains.length === 1
      ? `Research for ${domains[0]}`
      : `Research for ${domains.slice(0, -1).join(', ')} and ${domains[domains.length - 1]}`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    numResults: 10,
    outputSchema: NUMBER_OF_USERS_OBJECT_SCHEMA,
    stream: false,
    systemPrompt: SYSTEM_PROMPT_NUMBER_OF_USERS,
    type: 'deep-reasoning',
  });
}
