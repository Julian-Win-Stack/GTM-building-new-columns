import Exa from 'exa-js';
import { KEYS } from '../config.js';

export type DigitalNativeExaItem = {
  domain: string;
  category:
    | 'Digital-native B2C'
    | 'Digital-native B2B'
    | 'Digital-native B2B2C'
    | 'Digital-native B2C2B'
    | 'Digitally critical B2C'
    | 'Digitally critical B2B'
    | 'Digitally critical B2B2C'
    | 'Digitally critical B2C2B'
    | 'NOT Digital-native or digitally critical';
  confidence: string;
  reason: string;
  digital_criticality_signals: string[];
  source_links: string[];
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

const SYSTEM_PROMPT = `You are a strict digital business criticality classification system.

Your task is to classify a company into EXACTLY ONE of the following categories based on its PRIMARY revenue-generating business model and the business criticality of its digital systems.

CATEGORIES:

1. Digital-native B2C
Sells and delivers directly to individual consumers via a digital product. The consumer is both the buyer and the user.

2. Digital-native B2B
Sells software or digital services to businesses. The business is both the buyer and the primary daily end-user.

3. Digital-native B2B2C
Sells a digital platform to businesses, which then deploy that platform to serve their own end consumers. The platform’s primary output is a consumer-facing experience.

4. Digital-native B2C2B
Acquires individual consumers or prosumers first via a free or low-cost digital product, then monetizes by selling to businesses or employers.

5. Digitally critical B2C
A physical-first or legacy business that sells directly to consumers, but operates a large-scale consumer-facing digital platform that is critical to revenue, transactions, customer experience, or support. The company was not born digital, but its website/app is now business-critical.

6. Digitally critical B2B
A traditional or non-software-native business that sells primarily to businesses, but relies on digital systems, portals, apps, APIs, or online workflows that are critical to customer delivery, operations, revenue, or support.

7. Digitally critical B2B2C
A traditional or non-software-native business that sells to businesses, but powers or enables a consumer-facing experience for those businesses’ end customers through a digital platform, app, portal, marketplace, logistics system, payments flow, loyalty experience, or similar interface.

8. Digitally critical B2C2B
A traditional or non-software-native business that first reaches or serves individuals through a consumer-facing digital experience, then monetizes through employers, enterprises, institutions, or business partnerships.

9. NOT Digital-native or digitally critical
Physical-first or traditional businesses where software/internet is not central to revenue, customer experience, operations, or reliability risk. The business can operate largely unaffected without a large-scale digital platform.

KEY DISTINCTIONS:

Rule 1 — Is the company born-digital or digitally critical?
Ask: “Is the company’s core product or customer experience delivered through digital infrastructure?”

Classify as Digital-native if:
- The company was built around a digital product, platform, marketplace, app, API, or online service.
- The digital product is the core value proposition.
- The company could not meaningfully exist without its software platform.

Classify as Digitally critical if:
- The company was not born digital, or has significant physical/traditional operations, BUT
- It operates a large-scale digital surface such as a website, app, marketplace, customer portal, booking flow, e-commerce system, logistics system, payments flow, or API, AND
- Degradation or downtime would materially affect revenue, customer experience, support, operations, or brand trust.

Classify as NOT Digital-native or digitally critical ONLY IF:
- The digital component is minor, informational, or administrative, AND
- The business can operate largely unaffected without a large-scale digital platform.

Rule 2 — Who pays?
Identify whether the primary paying customer is:
- Individual consumers
- Businesses
- Employers
- Institutions
- Partners

Rule 3 — Who is the primary daily end-user?
Identify whether the primary user is:
- Individual consumers
- Business employees
- Business customers’ end consumers
- Prosumer individuals who later drive business adoption

Rule 4 — B2C vs B2B
Classify as B2C if individual consumers are both the buyer and the user.

Classify as B2B if businesses are the buyer and the primary daily users are the business’s own employees or internal teams.

Rule 5 — B2B2C
Classify as B2B2C if:
- The company sells to businesses, AND
- The product or platform is deployed outward to serve those businesses’ end consumers, AND
- The primary output is a consumer-facing experience, transaction, engagement, logistics flow, loyalty flow, financial flow, or customer interaction.

B2B2C does NOT require the vendor’s brand to be visible to the end consumer. White-labeled platforms can still be B2B2C.

TIEBREAKER — B2B vs B2B2C (when Rules 4 and 5 conflict):
Ask: "If you removed the end consumer entirely, would the product still have its core value?"

- If YES (e.g., a CRM still helps recruiters manage pipelines without candidates) → classify as B2B.
- If NO (e.g., a loyalty platform has no purpose without consumers earning and redeeming rewards) → classify as B2B2C.


Rule 6 — B2C2B
Classify as B2C2B if:
- The company first acquires individuals, consumers, creators, developers, students, or prosumers, AND
- Later monetizes through businesses, employers, institutions, enterprise plans, team plans, data, access, analytics, or partnerships.

Rule 7 — Digitally critical versions
If the company matches B2C, B2B, B2B2C, or B2C2B behavior but was not born digital, classify it into the corresponding Digitally critical category.

Examples:
- Legacy retailer with major e-commerce app → Digitally critical B2C
- Traditional bank with consumer mobile banking app → Digitally critical B2C
- Logistics company with business customer portal/APIs → Digitally critical B2B
- Airline with consumer booking/check-in systems → Digitally critical B2C
- Pharmacy chain with online ordering, prescriptions, and app-based customer flows → Digitally critical B2C
- Legacy benefits provider powering employee-facing benefits portals → Digitally critical B2B2C

SPECIAL CASE — IT Consulting & Managed Services:
If the company’s primary revenue comes from selling human expertise, professional services, staff augmentation, implementation, systems integration, managed IT services, or consulting, classify as NOT Digital-native or digitally critical.

These companies use software as a delivery vehicle, not as their core product or business-critical customer platform.

The reason field MUST state:
“Rejected: this is an IT consulting / professional services company. The core value delivered is human expertise and services, not a scalable digital platform.”

Examples:
- IT staffing firms
- Systems integrators
- Managed service providers
- Technology consultancies
- Offshore development shops

If this rule matches, stop and return NOT Digital-native or digitally critical.

TIEBREAKER:
Ask: “If the digital platform went down or degraded, would it materially affect revenue, customer experience, operations, support, or brand trust?”

- If YES, classify as Digital-native or Digitally critical.
- If NO, classify as NOT Digital-native or digitally critical.

Then ask:
“Was the company originally built around the digital product?”

- If YES, use Digital-native.
- If NO, use Digitally critical.

RESEARCH STEPS:

1. Visit the company’s homepage, About page, product pages, careers page, engineering blog, app pages, and relevant public documentation.
2. Identify the company’s primary revenue-generating business model.
3. Identify what the company sells, who pays, and who uses the product daily.
4. Determine whether the company was born digital or is a traditional/physical-first company with business-critical digital systems.
5. Determine whether downtime or degradation of the digital surface would affect revenue, transactions, customer experience, support, operations, or brand trust.
6. Apply Rules 1 → 7 and the Tiebreaker.
7. Select EXACTLY ONE category.


For each input company domain, return one object in the "companies" array with:

- domain: exact domain provided, lowercase, no www.
- category: one of the nine categories above
- confidence: High | Medium | Low
- reason: 2–3 sentences explaining:
  - what the company sells
  - who pays
  - who uses it daily
  - why it is digital-native, digitally critical, or neither
- digital_criticality_signals: array of specific public signals, such as:
  - e-commerce
  - mobile app
  - customer portal
  - marketplace
  - booking flow
  - payments flow
  - logistics/tracking system
  - API platform
  - online support experience
  - consumer account system
- source_links: array of URLs consulted

Always include every requested domain in our return output.`;

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
              'Digitally critical B2C',
              'Digitally critical B2B',
              'Digitally critical B2B2C',
              'Digitally critical B2C2B',
              'NOT Digital-native or digitally critical',
            ],
          },
          confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          reason: { type: 'string' },
          digital_criticality_signals: { type: 'array', items: { type: 'string' } },
          source_links: { type: 'array', items: { type: 'string' } },
        },
        required: ['domain', 'category', 'confidence', 'reason', 'digital_criticality_signals', 'source_links'],
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

Search thoroughly: Crunchbase, PitchBook, CB Insights, press releases, SEC filings, the company's own blog, and reputable business news. Most companies have at least one publicly reported funding event.

If no external funding is found after a thorough search, explain WHY in the growth field — never return a generic no-data string. Consider which of the following applies and write a brief one-sentence explanation:
- Bootstrapped / self-funded: no external capital has ever been raised (e.g. "Bootstrapped — no external funding publicly announced")
- Profitable and capital-efficient: company generates sufficient revenue and has not needed external capital (e.g. "Profitable and self-sustaining — no external funding raised")
- Already acquired: company was bought before or instead of raising externally (e.g. "Acquired by [Parent Co.] in [year] — no independent funding raised")
- Publicly traded / IPO'd: describe the IPO instead (e.g. "IPO'd on [exchange] in [year] at [valuation or share price if known]")
- Subsidiary or division: part of a larger parent company (e.g. "Subsidiary of [Parent Co.] — no independent funding history")
NEVER return an empty string for growth.

For each input company domain, return exactly one entry in companies[] with:
- domain: the exact domain provided (lowercase, no www.)
- growth: the round series and amount raised (e.g. "Series B, $50M" or "Seed, $2M"), OR a one-sentence explanation of why no external funding exists (see above). NEVER return an empty string.
- timeframe: the date or period of the announcement (e.g. "March 2024" or "Q1 2024"). Return "" when no funding round was found.
- evidence: the source URL of the announcement. Return "" when no funding round was found.

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

const SYSTEM_PROMPT_NUMBER_OF_USERS = `Research the total number of users, customers, or accounts for the companies. Prioritize the most recent count; if current data is unavailable, report the most recently known historical count with its date; if no disclosed count exists at all, infer from proxy signals. Use the "unknown" bucket only as a last resort when all three approaches yield nothing — and even then, describe what you tried in user_count. NEVER write "unknown", "no user count found", or any similar no-data string as the user_count value.

STEP 1 — Search for a directly disclosed current count.
Accepted evidence:
- Official sources: press releases, blog posts, earnings calls, SEC filings, S-1s, founder interviews, company homepage claims ("trusted by 10,000 teams"), verified news articles
- G2 / Trustpilot review counts: multiply by 50–100x as a low-confidence proxy for actual customers
- App Store / Google Play install counts or disclosed DAU/MAU figures
- ARR ÷ ACV only when BOTH values are explicitly stated in the same public source (e.g. "$20M ARR" and "$5K ACV" both cited → ~4,000 customers)
- Third-party estimates from Sacra, Growjo, Latka, CB Insights, or PitchBook

STEP 2 — If no current count is found, search for the most recent historical count.
Look in older blog posts, press releases, archived pages, and dated articles. Report the best count found and include the source date. Use a "~" prefix and note the date to signal it may be outdated (e.g. "~200K users (as of 2022 blog post)"). Do not skip this step — always attempt it before inferring.

STEP 3 — If no disclosed count (current or historical) exists, infer from proxy signals as a last resort.
Use any combination of:
- Funding stage and valuation (late-stage rounds imply larger user bases)
- Headcount × typical users-per-employee ratios for the business model
- App downloads, DAU/MAU, store rankings (data.ai, Sensor Tower)
- Web traffic trends from SimilarWeb
- Customer logo count × typical ACV
- Third-party estimates from Sacra, Growjo, Latka
Express inferred counts with "~" and "(estimated)" and explain the signals in the reasoning field (e.g. "~50K users (estimated from 200 employee headcount × SaaS B2B ratio)").

STEP 4 — Assign a bucket based on whatever was found in Steps 1–3.
Pick the single best-fit bucket:
- "<100" — evidence shows fewer than 100 users/customers
- "100–1K" — evidence points to 100–1,000
- "1K–10K" — evidence points to 1,000–10,000
- "10K–100K" — evidence points to 10,000–100,000
- "100K+" — evidence points to 100,000 or more
- "unknown" — genuinely zero evidence across all three steps; use only as a last resort

STEP 5 — Confidence calibration:
- "high" — direct count from official source within last 12 months
- "medium" — credible third-party estimate (Sacra, Growjo, Latka), ARR÷ACV with both values explicitly disclosed, or official historical count older than 12 months
- "low" — G2 review count multiplied; inferred from proxy signals; or bucket is "unknown"

For each input company domain, return exactly one entry in companies[] with:
- domain: the exact domain provided (lowercase, no www.)
- user_count: human-readable description of what was found or estimated (e.g. "~500K MAU per 2024 blog post", "~200K users (as of 2022 press release)", "~50K (estimated from proxy signals)"). NEVER write "unknown", "no user count found", or any equivalent — always describe the count or the best inference.
- user_count_bucket: one of "<100", "100–1K", "1K–10K", "10K–100K", "100K+", "unknown"
- reasoning: 1–3 sentences on what evidence was found and how the estimate was reached
- source_link: URL of the strongest source used, or "" when only inference was used
- source_date: publication date in ISO 8601 or approximate form, or "" when unknown
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
          user_count_bucket: { type: 'string', enum: ['<100', '100–1K', '1K–10K', '10K–100K', '100K+', 'unknown'] },
          reasoning: { type: 'string' },
          source_link: { type: 'string' },
          source_date: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['domain', 'user_count', 'user_count_bucket', 'reasoning', 'source_link', 'source_date', 'confidence'],
      },
    },
  },
  required: ['companies'],
} as const;

export async function numberOfUsersExaSearch(domains: string[]): Promise<ExaSearchResponse> {
  if (domains.length === 0) throw new Error('numberOfUsersExaSearch: need at least 1 domain');

  const query = `Find total users, customers, or accounts for: ${domains.join(', ')}`;

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

const AI_ADOPTION_MINDSET_SYSTEM_PROMPT = (companyName: string) =>
  `You are an analyst classifying a company's AI adoption mindset using only explicit, verifiable public evidence.

Classify ${companyName} as one of: Aggressive, Neutral, or Conservative.

Aggressive = AI is core to strategy, company-wide mandates, org changes driven by AI, urgency from leadership.
Neutral = AI is incremental, selective, experimental, balanced tone.
Conservative = AI is framed as risky, governance-first, restricted, skeptical tone dominates.

You may draw evidence from any of the following public sources:
- LinkedIn posts from employees or leadership
- Executive blog posts or articles
- Company blog posts or press releases
- Job postings and hiring patterns related to AI roles
- Conference talks or interviews
- Earnings calls or investor statements

Use hiring signals as strong evidence. A company aggressively hiring for AI-specific roles, creating new AI functions, or restructuring teams around AI indicates aggressive adoption. A company with few or no AI-specific roles, or roles focused purely on governance and oversight, may indicate conservative adoption.

Output format:
Classification: <Aggressive | Neutral | Conservative | Not publicly confirmed>
Confidence: <High | Medium | Low>
Evidence:
- "<paraphrase of statement or observation>" (source URL)
- "<paraphrase of statement or observation>" (source URL)
Reasoning:
- 2 to 4 bullet points tied directly to evidence

Rules:
- Only use explicit, verifiable statements or observable facts from the search results
- Do not infer or assume internal practices beyond what is directly stated
- Do not classify based on keywords alone
- If signals conflict, choose the dominant pattern and lower confidence
- If evidence is insufficient, output: Not publicly confirmed
- Prioritize actions and hiring patterns over rhetoric
- Prioritize executive statements over general employee posts`;

export async function aiAdoptionMindsetExaSearch(
  companyName: string,
  domain: string
): Promise<ExaSearchResponse> {
  const query = `${domain} engineers and executives sharing their views on how AI is being used internally, AI strategy, and the company's approach to AI adoption`;
  const additionalQuery = `${companyName} AI job postings hiring engineers researchers or job posts that are related to AI adoption mindset`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    additionalQueries: [additionalQuery],
    numResults: 10,
    outputSchema: { type: 'text' },
    stream: false,
    systemPrompt: AI_ADOPTION_MINDSET_SYSTEM_PROMPT(companyName),
    type: 'deep-reasoning',
    contents: {
      highlights: {
        query: 'AI strategy adoption mandate restructuring governance internal use',
      },
    },
  });
}

const AI_SRE_MATURITY_SYSTEM_PROMPT = (companyName: string) =>
  `You are a research analyst evaluating a company's AI SRE maturity for a B2B sales context. Your goal is to determine whether this company is a likely buyer of an AI SRE product, is already building their own, or is working with a competitor.

Target company: ${companyName}

You may use evidence from any of the following public sources:
- LinkedIn posts or articles from engineers, SREs, or leadership
- Engineering blogs or technical case studies
- Job postings related to SRE, incident response, or reliability engineering
- YouTube videos, conference talks, or live streams
- Interviews with engineering or operations leadership
- Vendor case studies or customer references naming the company
- GitHub repositories or open source projects related to incident automation

Classify the company into exactly one of the following:

building in-house = the company is actively building its own internal AI system for incident response, on-call automation, triage, or RCA.
working with vendors = the company is a confirmed customer or named user of an AI SRE or incident management vendor such as Resolve.ai, Incident.io, Rootly, FireHydrant, or similar.
ideating = the company is exploring, discussing, piloting, or experimenting with AI for SRE or incident response but has not confirmed a build or vendor adoption.
not ready = the company's SRE and incident management practices are too immature, manual, or underdeveloped for credible AI SRE adoption in the near term.
unverified = not enough public evidence to classify confidently.

Sales interpretation guidance:
- building in-house = low likelihood to buy, already investing internally
- working with vendors = already bought from a competitor, re-engagement opportunity
- ideating = high likelihood to buy, actively thinking about the problem
- not ready = not a near-term buyer, foundational gaps need to be addressed first
- unverified = requires outbound discovery to qualify

Use hiring signals as strong evidence. A company hiring SRE engineers with AI or automation responsibilities, or creating dedicated incident automation roles, is a strong signal of either building in-house or high readiness to adopt.

Output format:
Classification: <building in-house | working with vendors | ideating | not ready | unverified>
Confidence: <High | Medium | Low>
Sales signal: <Strong buy | Competitor risk | High potential | Not ready | Unknown>
Evidence:
- "<paraphrase of statement or observation>" (source URL)
- "<paraphrase of statement or observation>" (source URL)
Reasoning:
- 2 to 5 bullet points tied directly to evidence
- Prioritize actions and hiring patterns over rhetoric
- Do not make assumptions

Rules:
- Only use explicit, verifiable evidence from the search results
- Do not infer vendor usage from logos, integrations, or vague partnership mentions
- Do not infer in-house development from general AI enthusiasm alone
- Do not classify based on company size or valuation alone
- If signals conflict, choose the strongest explicitly supported category and lower confidence
- If evidence is insufficient, classify as unverified`;

const INDUSTRY_CATEGORIES = [
  'E-commerce',
  'Marketplaces',
  'Fintech',
  'Payments',
  'Crypto / Web3',
  'Consumer social',
  'Media / Streaming',
  'Gaming',
  'On-demand / Delivery',
  'Logistics / Mobility',
  'Travel / Booking',
  'SaaS (B2B)',
  'SaaS (prosumer / PLG)',
  'Developer tools / APIs',
  'Data / AI platforms',
  'Cybersecurity',
  'Adtech / Martech',
  'Ride-sharing / transportation networks',
  'Food tech',
  'Creator economy platforms',
  'Market data / trading platforms',
  'Real-time communications (chat, voice, video APIs)',
  'IoT / connected devices platforms',
  'Unknown',
] as const;

const INDUSTRY_OBJECT_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          industry: { type: 'string', enum: [...INDUSTRY_CATEGORIES] },
          reason: { type: 'string' },
        },
        required: ['domain', 'industry', 'reason'],
      },
    },
  },
  required: ['companies'],
} as const;

const INDUSTRY_SYSTEM_PROMPT = `Classify each company's primary industry.

Allowed Industry Categories (choose exactly one — no other values allowed):
E-commerce | Marketplaces | Fintech | Payments | Crypto / Web3 | Consumer social | Media / Streaming | Gaming | On-demand / Delivery | Logistics / Mobility | Travel / Booking | SaaS (B2B) | SaaS (prosumer / PLG) | Developer tools / APIs | Data / AI platforms | Cybersecurity | Adtech / Martech | Ride-sharing / transportation networks | Food tech | Creator economy platforms | Market data / trading platforms | Real-time communications (chat, voice, video APIs) | IoT / connected devices platforms | Unknown

Instructions:
- Read the company description carefully.
- Select 1 primary industry that best represents the core business.
- If multiple apply, choose the dominant revenue-generating activity.
- Do NOT invent new categories.
- Do NOT over-classify (only one label).
- If unclear or insufficient info → return "Unknown".

For each input domain, return one object in the "companies" array with:
- domain: the exact domain provided (lowercase, no www.)
- industry: exactly one category from the allowed list above
- reason: brief justification based on the company's core business (1–2 sentences)

Always include every requested domain in the companies array.`;

export async function industryExaSearch(domains: string[]): Promise<ExaSearchResponse> {
  if (domains.length === 0) throw new Error('industryExaSearch: need at least 1 domain');

  const query =
    domains.length === 1
      ? `Research for ${domains[0]}`
      : `Research for ${domains.slice(0, -1).join(', ')} and ${domains[domains.length - 1]}`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    numResults: 10,
    outputSchema: INDUSTRY_OBJECT_SCHEMA,
    stream: false,
    systemPrompt: INDUSTRY_SYSTEM_PROMPT,
    type: 'deep-reasoning',
    contents: { highlights: true },
  });
}

export async function aiSreMaturityExaSearch(
  companyName: string,
  domain: string
): Promise<ExaSearchResponse> {
  const query = `The company - ${domain} engineers and SRE teams talking about how they handle incident response, on-call automation, and whether they are building or buying AI tools for reliability and operations`;
  const additionalQuery = `${domain} SRE on-call incident response automation AI triage job postings`;

  return await (exa.search as (q: string, opts: object) => Promise<ExaSearchResponse>)(query, {
    additionalQueries: [additionalQuery],
    numResults: 10,
    outputSchema: { type: 'text' },
    stream: false,
    systemPrompt: AI_SRE_MATURITY_SYSTEM_PROMPT(companyName),
    type: 'deep-reasoning',
    contents: {
      highlights: {
        query: 'incident response automation on-call triage root cause analysis AI SRE reliability engineering',
      },
    },
  });
}
