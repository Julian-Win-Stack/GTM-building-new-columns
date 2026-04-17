import Exa from 'exa-js';
import { KEYS } from '../config.js';

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
8. Output your classification in this exact format:

   CATEGORY: [chosen category]
   CONFIDENCE: [High / Medium / Low]
   REASON: [2–3 sentences referencing specific product behavior — who uses it daily, what the platform outputs, and whether consumers are the core value driver. Do not rely solely on company descriptions or marketing language.]

Input:
company domain`;

const OUTPUT_SCHEMA_DESC =
  'For each company domain provided, output your answer in this exact format:\n\n' +
  '[domain]\n' +
  'CATEGORY: [one of: Digital-native B2C | Digital-native B2B | Digital-native B2B2C | Digital-native B2C2B | NOT Digital-native]\n' +
  'CONFIDENCE: [High | Medium | Low]\n' +
  'REASON: [2–3 sentence justification referencing specific product behavior, not just company description]\n\n' +
  'Repeat this block for each company.';

export async function digitalNativeExaSearch(domains: string[]): Promise<unknown> {
  if (domains.length === 0) throw new Error('digitalNativeExaSearch: need at least 1 domain');

  const query =
    domains.length === 1
      ? `Research for ${domains[0]}`
      : `Research for ${domains.slice(0, -1).join(', ')} and ${domains[domains.length - 1]}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (exa.search as any)(query, {
    numResults: 10,
    outputSchema: { type: 'text', description: OUTPUT_SCHEMA_DESC },
    stream: false,
    systemPrompt: SYSTEM_PROMPT,
    type: 'deep-reasoning',
    contents: { highlights: { maxCharacters: 4000 } },
  });
}
