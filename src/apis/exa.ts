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
- IMPORTANT: If a single source (job posting, blog post, LinkedIn profile, etc.) mentions multiple ALLOWED TOOLS, emit one line per tool — each with the same source URL. Do NOT collapse multiple tools from the same source into a single line.

Example toolsText for a company where one job post mentions both Datadog and Prometheus, and a LinkedIn profile mentions Grafana:
Datadog: https://jobs.ashbyhq.com/example/abc
Prometheus: https://jobs.ashbyhq.com/example/abc
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
    type: 'deep',
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

const SYSTEM_PROMPT_REVENUE_GROWTH = `Research the revenue and revenue growth of the companies over the last 12 months. You MUST always return a numeric revenue estimate AND a growth-rate estimate — never skip with "Not publicly confirmed" or "Unknown" unless you have genuinely found zero usable signals.

STEP 1 — Look for direct revenue figures.
Search earnings calls, press releases, SEC filings, S-1s, 10-Ks, founder interviews, analyst reports, Bloomberg, Reuters, verified news. If you find revenue figures for at least the latest two points for revenue growth, compute the growth rate directly and add the data of the latest growth evidence in the response.

STEP 2 — If exact figures are NOT available, you MUST infer an estimated revenue figure AND growth rate from proxy signals. Do NOT skip this step. Use any combination of these signals:
* Funding stage and valuation — late-stage rounds (Series C+) typically imply $20M–$100M+ ARR; valuations at ~10–20× ARR multiples are a common heuristic
* Headcount × revenue-per-employee benchmarks (e.g. SaaS: $200K–$400K per employee; consumer: $300K–$1M per employee; infra/devtools: $250K–$500K per employee). Use LinkedIn employee count.
* Headcount growth rate over the last 12 months — sustained 30%+ hiring usually maps to similar revenue growth; flat headcount maps to flat revenue; layoffs to decline
* Customer count × average contract value (ACV) — if the company discloses logos and a pricing page exists, multiply
* Web traffic trends from SimilarWeb (signal for consumer / freemium / PLG)
* App downloads, DAU/MAU, store rankings (data.ai, Sensor Tower)
* Third-party estimates from Sacra, Growjo, CB Insights, PitchBook, Bloomberg Second Measure, Latka

STEP 3 — Combine signals into an explicit estimate.
Always express the estimate with the "~" tilde and "(estimated)" suffix when inferred. Examples:
- "~$15M ARR (estimated), growing ~40% YoY"
- "~$80M revenue (estimated), growing ~25% YoY"
- "~$500K ARR (estimated), declining ~10% YoY"
Show your math in the reasoning field (e.g. "120 employees × $250K rev/employee benchmark = ~$30M ARR; headcount up 35% YoY suggests similar revenue growth").

STEP 4 — Confidence calibration:
- "high" — direct revenue figures from official sources within last 12 months
- "medium" — strong proxy signals (multiple converging data points, recent funding round disclosing ARR multiple, credible third-party estimates)
- "low" — weak proxies (only headcount or only traffic), or older data extrapolated forward

If signals conflict, weight them in this order:
1. Direct revenue disclosures (highest trust)
2. Recent funding round ARR multiples disclosed by investors
3. Headcount × revenue-per-employee benchmark
4. Web/app traffic trends
5. Third-party estimates (Growjo, Sacra, Latka)

Note conflicting signals explicitly in the reasoning field and explain which you weighted and why.

Only return "Insufficient data" if ALL of the following are true:
- No employee count found on LinkedIn or Crunchbase
- No funding history available
- No web traffic data accessible
- No customer count or pricing publicly visible
- No third-party revenue estimates found on Sacra, Growjo, Latka, or CB Insights

For each input company domain, return exactly one entry in companies[] with:
- domain: the exact domain provided (lowercase, no www.)
- growth: the revenue figure AND growth rate, always with units (see Step 3 examples). Prefer "~$Xm ARR (estimated), growing ~Y% YoY" format.
- evidence: the source URL of the strongest supporting data point used
- source_date: the publication or "as-of" date of the source in evidence. Use ISO 8601 when an exact date is known (e.g. "2024-03-15"); use a month/quarter/year when the source is less precise (e.g. "March 2024", "Q1 2024", "2024"). Return "" only when no date can be determined from the source.
- reasoning: 2–4 sentences showing the signals used and how the estimate was derived (include the math when inferred)
- confidence: "high", "medium", or "low"

Always include every requested domain in the companies array.`;

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
          source_date: { type: 'string' },
          reasoning: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['domain', 'growth', 'evidence', 'source_date', 'reasoning', 'confidence'],
      },
    },
  },
  required: ['companies'],
} as const;

export async function revenueGrowthExaSearch(domains: string[]): Promise<ExaSearchResponse> {
  if (domains.length === 0) throw new Error('revenueGrowthExaSearch: need at least 1 domain');

  const query = `Estimate revenue, ARR, funding stage, valuation, employee headcount, hiring growth, customer count, and revenue trajectory over the last 12 months for: ${domains.join(', ')}`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    numResults: 10,
    outputSchema: REVENUE_GROWTH_OBJECT_SCHEMA,
    stream: false,
    systemPrompt: SYSTEM_PROMPT_REVENUE_GROWTH,
    type: 'deep-reasoning',
    contents: {
      text: { maxCharacters: 100000 },
    },
  });
}

const SYSTEM_PROMPT_NUMBER_OF_USERS = `Research the total number of users, customers, or accounts for the companies. You MUST always return a numeric estimate — never skip with "Not publicly disclosed" or "Unknown" unless you have genuinely found zero usable signals.

STEP 1 — Look for an exact disclosed count.
Search official sources: press releases, blog posts, earnings calls, SEC filings, S-1s, founder interviews, verified news, the company's own homepage ("trusted by 10,000 teams" type claims), G2 / Trustpilot review counts, App Store / Google Play install counts. If an exact number is found, record it with the unit ("monthly active users", "paying customers", "registered accounts", "businesses", etc.), date, and source URL.

STEP 2 — If no exact count is publicly disclosed, you MUST infer an estimated user count from proxy signals. Do NOT skip this step. Use any combination of these signals:
* ARR or revenue ÷ average contract value (ACV) — e.g. $20M ARR ÷ $5K ACV ≈ 4,000 customers
* Pricing tiers × headcount or funding stage — extrapolate likely customer mix
* Funding stage benchmarks — Series A SaaS typically 50–500 customers; Series B 500–5,000; Series C 5,000+
* Employee headcount × industry user-per-employee ratios (consumer apps: 100K–1M users/employee; SaaS: 50–500 customers/employee)
* App store install counts, DAU/MAU figures, store rankings (data.ai, Sensor Tower)
* Web traffic from SimilarWeb (monthly visits is a useful upper bound for free/freemium signups)
* Number of enterprise logos × typical seat counts for the customer's industry
* Geographic markets / countries served — proxy for scale
* Third-party estimates from Sacra, Growjo, Latka, CB Insights, PitchBook, G2

STEP 3 — Combine signals into an explicit numeric estimate.
Always express inferred numbers with the "~" tilde and "(estimated)" suffix. Examples:
- "~5,000 customers (estimated)"
- "~250K MAU (estimated)"
- "~80 enterprise customers (estimated)"
Show your math in the reasoning field (e.g. "$15M ARR disclosed ÷ ~$3K average ACV from pricing page = ~5,000 customers").

STEP 4 — Confidence calibration:
- "high" — direct disclosed count from official source within last 12 months
- "medium" — strong proxy (e.g. ARR ÷ ACV with both numbers grounded; credible third-party estimate)
- "low" — weak proxies (only headcount, only traffic), order-of-magnitude estimate

G2 or Trustpilot review counts: multiply by 30–100x to estimate actual customer count (typical review rate is 1–3% of customers). Weight this as a low-confidence signal unless corroborated.

Only return "Insufficient data" if ALL of the following are true:
- No employee count on LinkedIn or Crunchbase
- No funding history available
- No app store presence or web traffic data
- No pricing page or customer count claim found
- No third-party estimates on Sacra, Growjo, Latka, G2, or CB Insights

App store install counts: apply a 20–40% active-user discount for consumer apps (assume 60–80% of installs are dormant or churned). Use store rankings as a directional signal, not a precise count.

Web traffic (SimilarWeb): only use as a proxy for consumer, freemium, or PLG-driven products. For sales-led B2B SaaS, disregard or use only as a sanity check, not a primary signal.

If signals suggest different scales (e.g. large free user base vs small paid customer base), report both separately:
- "paid_customers": "~500 paying customers (estimated)"
- "free_users": "~2M registered/free users (estimated)"

Only collapse them if the company is purely paid with no free tier.

For each input company domain, return exactly one entry in companies[] with:
- domain: the exact domain provided (lowercase, no www.)
- user_count: the count, always with units (see Step 3 examples). Prefer "~N units (estimated)" when inferred.
- reasoning: 2–4 sentences showing the signals used and the math when inferred
- source_link: the URL of the strongest supporting source used (source_link: for direct disclosures, link to the exact source. For inferred estimates, link to the single strongest signal used (e.g. the funding announcement if ARR multiple was the key input, the LinkedIn page if headcount was primary).)
- source_date: the publication or "as-of" date of the source in source_link. Use ISO 8601 when an exact date is known (e.g. "2024-03-15"); use a month/quarter/year when the source is less precise (e.g. "March 2024", "Q1 2024", "2024"). Return "" only when no date can be determined from the source.
- confidence: "high", "medium", or "low"



Always include every requested domain in the companies array.`;

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
          source_date: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['domain', 'user_count', 'reasoning', 'source_link', 'source_date', 'confidence'],
      },
    },
  },
  required: ['companies'],
} as const;

export async function numberOfUsersExaSearch(domains: string[]): Promise<ExaSearchResponse> {
  if (domains.length === 0) throw new Error('numberOfUsersExaSearch: need at least 1 domain');

  const query = `Estimate total users, customers, accounts, ARR, pricing, funding stage, employee headcount, app downloads, and web traffic for: ${domains.join(', ')}`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    numResults: 10,
    outputSchema: NUMBER_OF_USERS_OBJECT_SCHEMA,
    stream: false,
    systemPrompt: SYSTEM_PROMPT_NUMBER_OF_USERS,
    type: 'deep-reasoning',
    contents: {
      text: { maxCharacters: 100000 },
    },
  });
}
