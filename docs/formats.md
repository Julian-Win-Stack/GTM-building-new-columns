# Attio Output Formats

Per-column format specs, Exa output schema details, and API mapping. Read this when adding or modifying a stage formatter or parser.

---

## Identity columns (Company Name, Domain, LinkedIn Page, Description, Website, Account Purpose, Apollo ID)

Written once at pipeline start (before Stage 1) for every CSV row:
- Fill any column that is currently **empty** in Attio using the CSV value. Never overwrite a non-empty value.
- Match Attio record by `Domain` when the CSV row has a Website, otherwise by `LinkedIn Page`. Never by Company Name.
- `Description` comes from CSV column `Short Description`.
- `LinkedIn Page` is written as a **bare slug** (e.g. `playstation-sony`), not a URL. Attio's `linkedin` attribute is a validated handle field that rejects `www.`, `/showcase/` paths, and trailing slashes with `"LinkedIn handle is not valid"`. The pipeline extracts the slug from any CSV-supplied URL via `linkedInSlugForAttio()`; the original URL is still passed to Apify for Stage 10 (Number of SREs). Skipped silently when the slug can't be extracted.
- `Apollo ID` comes from CSV column `Apollo Account Id` (slug: `apollo_id`). Skipped silently when the CSV cell is empty; companies without it are still enriched.
- Skip rows with neither a Domain nor a LinkedIn URL entirely.
- Rows missing a Website are skipped at preflight — every CSV row needs **both** a Website and a LinkedIn URL to be processed. There is no LinkedIn-only resolution path; a missing Website cannot be back-filled from Attio.
- `Account Purpose` is written via `--account-purpose <value>` CLI flag (always overwrites) for every CSV row in the run.

---

## Stage Attio value formats

### Digital Native (Stage 2)
```
<category>

Confidence: <High | Medium | Low>

Reasoning: <Exa's reason text>

Signals:
<signal1>
<signal2>

Sources:
<url1>
<url2>
```
`Signals:` block omitted when `digital_criticality_signals` is empty. `Sources:` block omitted when Exa returns no links.

---

### Number of Users (Stage 3)
```
User count: <human-readable, e.g. "~500K MAU per 2024 blog post" or "unknown">

User count bucket: <<100 | 100–1K | 1K–10K | 10K–100K | 100K+ | unknown>

Reasoning: <evidence found, or why unknown>

Source link: <source URL>

Source date: <ISO date or month/quarter/year>

Confidence: <high | medium | low>
```
`Reasoning`, `Source link`, `Source date` omitted when empty. `Confidence` always present.
Exa uses only directly disclosed evidence (press releases, official claims, ARR÷ACV when both explicitly stated, third-party estimates). Funding benchmarks and headcount ratios not used.
Gate: `Digital-native B2B` and `Digitally critical B2B` companies must have `user_count_bucket === '100K+'`. `unknown` bucket passes (flag for human review). Fetch errors pass. All other categories (digital-native non-B2B, digitally critical non-B2B) pass unconditionally.

---

### Observability Tool (Stage 4)
```
<Tool name>: <source URL>
<Tool name>: <source URL>
```
LinkedIn profile URLs (`linkedin.com/in/*`) are verified via Azure OpenAI `judge()` against the full page text — kept only if OpenAI returns `verdict: "yes"`. All other source URLs accepted without verification. LinkedIn profiles not in `results[]` (no page text) are dropped.
If no evidence: `No evidence found`.

---

### Communication Tool (Stage 5)
```
Slack: <source_url>
```
or `Microsoft Teams: <source_url>`. Two sequential TheirStack calls per company: Slack first, then Microsoft Teams only if Slack returned nothing.
If no evidence: `No evidence found`.

---

### Cloud Tool (Stage 6)
```
AWS: <source_url>
```
or `GCP: <source_url>`, or `Both: <source_url>`.
Gate passes: AWS / GCP / Both / no evidence. Rejects any other cloud (Azure, IBM, etc.).
If no evidence: `No evidence found`.

---

### Competitor Tooling (Stage 1)
Comma-joined tool names on first line, blank line, then one `Evidence:` line per tool:
```
Rootly, Komodor

Evidence: (Rootly's customer page)
Evidence: https://jobs.example.com/123
```
Hardcoded match → `Evidence: (<Tool>'s customer page)`. TheirStack match → `Evidence: <url>`.
No match → `Not using any competitor tools`.

---

### Funding Growth (Stage 7)
```
Growth: <round and amount, e.g. "Series B, $50M">

Timeframe: <date or period>

Evidence: <source URL>
```
`Timeframe` and `Evidence` omitted when empty.

---

### Revenue Growth (Stage 8)
```
Growth: <revenue + trajectory, e.g. "~$15M ARR (estimated), growing ~40% YoY">

Evidence: <source URL>

Source date: <ISO date or month/quarter/year>

Reasoning: <signals used and the math>

Confidence: <high | medium | low>
```
`Evidence`, `Source date`, `Reasoning` omitted when empty. `Confidence` always present. Exa must infer a numeric estimate from proxy signals — `"Insufficient data"` only when zero usable signals.

---

### Number of Engineers (Stage 9)
Plain integer as string, e.g. `47` or `0`. Write `0` when Apollo returns no matches — do not leave blank.

---

### Number of SREs (Stage 10)
```
3

https://linkedin.com/in/person1
https://linkedin.com/in/person2
```
Written as `N/A` when company has no `Company Linkedin Url`. Written as plain integer (e.g. `0`) when Apify returns items with no `linkedinUrl`. Cap: 20 (`maxItems: 20`). Titles searched: `["SRE", "Site Reliability", "Site Reliability Engineer"]`. Excluded seniority IDs: `["310", "320"]`.

---

### Engineer Hiring (Stage 11)
```
5

Senior Engineer: https://acme.com/jobs/1
SRE: https://acme.com/jobs/2
```
Written as `0` when actor returns no matching jobs. Titles filtered via `titleSearch`/`titleExclusionSearch` constants in `engineerHiring.ts`.

---

### SRE Hiring (Stage 12)
Same format as Engineer Hiring, filtered to titles containing "SRE" or "Site Reliability" (case-insensitive). Written as `0` when no matches. Derived from the same Apify response as Stage 11 — no second API call.

---

### Customer complains on X (Stage 13)
Four lines, always present (zeros included):
```
Full outage: X
Partial outage: X
Performance degradation: X
Unclear: X
```
Fetched via twitterapi.io (`@<domain-sld> OR <domain> OR "<Company Name>"` + complaint keywords, `since_time=90 days ago`). Paginated until 50 tweets or `has_next_page=false`. Truncated to 50 before OpenAI classification.

---

### Recent incidents ( Official ) (Stage 14)
```
Critical: 1  |  Major: 3  |  Minor: 7  |  None: 2

Top affected components: Dashboard (4), API (3), Edge Network (2)

Incidents (last 90 days):
- [major] Dashboard slowness — Dashboard
- [critical] API outage — API, Edge Network
```
Per-incident line omits em-dash + component list when no components. Full list, no cap. Top components sorted by count desc, tie-broken alphabetically.

Three sentinel strings:
- `Private status page` — probe returned HTTP 401.
- `No status page found` — all probes failed or returned non-JSON.
- `0 incidents (last 90 days)` — page exists but no incidents in window.

Probe order (first win): `https://status.{domain}/api/v2/incidents.json` → `https://{slug}.statuspage.io/...` for each slug from `slugCandidates(companyName)` (strips legal suffixes, returns compact + dashed variants).
Pagination: `?limit=100&page=N`, stops when oldest `created_at` > 90 days, page < 100 items, or 10-page cap.

---

### AI adoption mindset (Stage 15)
Verbatim text from Exa (`outputSchema: { type: 'text' }`), no reformatting:
```
Classification: <Aggressive | Neutral | Conservative | Not publicly confirmed>
Confidence: <High | Medium | Low>
Evidence:
- "<paraphrase>" (source URL)
Reasoning:
- 2 to 4 bullet points
```
Per-company (batchSize: 1). Query, `additionalQueries`, and `systemPrompt` are company-specific. No link validation.

---

### AI SRE maturity (Stage 16)
Verbatim text from Exa (`outputSchema: { type: 'text' }`), no reformatting:
```
Classification: <building in-house | working with vendors | ideating | not ready | unverified>
Confidence: <High | Medium | Low>
Sales signal: <Strong buy | Competitor risk | High potential | Not ready | Unknown>
Evidence:
- "<paraphrase>" (source URL)
Reasoning:
- 2 to 5 bullet points
```
Per-company (batchSize: 1). Company-specific query + systemPrompt. No link validation. Operates independently of Stage 15.

**Shortcut path:** when Competitor Tooling is non-empty and not `Not using any competitor tools`, Stage 16 skips Exa entirely and writes `Working with vendor: <tool names>\n\n<evidence lines from Stage 1>` to AI SRE maturity. Stage 20 (Intent Signal Score) maps this to its "working with vendor" pattern.

---

### Industry (Stage 17)
```
industry: <one of the 23 categories, or Unknown>
reason: <brief justification>
```
23 allowed categories: E-commerce, Marketplaces, Fintech, Payments, Crypto / Web3, Consumer social, Media / Streaming, Gaming, On-demand / Delivery, Logistics / Mobility, Travel / Booking, SaaS (B2B), SaaS (prosumer / PLG), Developer tools / APIs, Data / AI platforms, Cybersecurity, Adtech / Martech, Ride-sharing / transportation networks, Food tech, Creator economy platforms, Market data / trading platforms, Real-time communications (chat, voice, video APIs), IoT / connected devices platforms.
`Unknown` when insufficient information. Off-enum value → cell left blank, company retried next run. Batch-of-2 (`batchSize: 2`).

---

### Company Context Score (Stage 18)
```
<score>

Reasoning: <2–4 sentences covering product nature, reliability sensitivity, industry, scale, and business model>
```
Score: 0–5 in 0.5 increments. Per-company (batchSize: 1). Uses `AZURE_DEPLOYMENT_PRO` (`gpt-5.4-pro`, hardcoded in `src/apis/openai.ts`).

**Hash-gating:** sha256 hash of all 17 prior enrichable column values stored in the **Company Context Score Change Detection for Developer** column (slug `company_context_change_detection_column_for_developer`). Re-scores only when hash differs or is missing. Durable across machines (stored in Attio). Adding a new upstream enrichable column automatically invalidates all hashes → full re-score on next run.

---

### Tooling Match Score (Stage 19)
```
Final Tool Score: <average of 4 sub-scores>
Communication Tool Score: <0 | 3 | 5>
Competitor Tooling Score: <1 | 3 | 5>
Observability Tool Score: <1 | 3 | 4 | 5>
Cloud Tool Score: <4 | 5>

Justification:
- Communication Tool: <explanation or "Not publicly confirmed">
- Competitor Tooling: <explanation or "Not publicly confirmed">
- Observability Tool: <explanation or "Not publicly confirmed">
- Cloud Tool: <explanation or "Not publicly confirmed">
```
Final Tool Score computed locally (not trusted from model). Sub-score rules:
- Communication: 5=Slack, 3=no evidence, 0=Teams
- Competitor: 1=any 1-pt tool (Resolve.ai/Traversal/TierZero/RunLLM/Neubird/Wildmoose/Ciroos/Komodor/Mezmo), 3=Rootly/incident.io, 5=none
- Observability: 1=other sole tool, 5=Datadog sole, 4=Datadog+anything or Grafana/Prometheus, 3=no evidence
- Cloud: 5=AWS/GCP, 4=Azure or no evidence

Hash-gated via `tooling_match_change_detection_for_developer` — covers only the 4 tooling inputs. Independent of Stage 18 hash.

---

### Intent Signal Score (Stage 20)
```
Intent Signal Score: <score>

Reasoning:
<2–4 sentences covering complaints, hiring, SRE maturity, incidents, AI adoption>
```
Score: 0–5 in 0.5 increments. Hash-gated via `intent_signal_change_detection_for_developer` — covers 8 buying-signal inputs (Tier 1: Customer complains on X, Engineer Hiring, SRE Hiring, AI SRE maturity; Tier 2: Recent incidents, AI adoption mindset; Tier 3: Funding Growth, Revenue Growth). Missing data → reasoning says "Not publicly confirmed".

---

### Final Score (Stage 21)
```
Final Score: <X.X>
Tier: Tier <1|2|3|4|5>

Reasoning:
<2–4 sentences>
```
Formula (local): `round1(0.5 × Intent + 0.3 × Context + 0.2 × Tooling)`. Two-step rounding prevents float drift. Tiers: ≥4.5→T1, ≥3.5→T2, ≥2.5→T3, ≥1.5→T4, else T5. Hard override: Context=0 → Final Score=0, Tier 5 (no OpenAI call). OpenAI called only for reasoning paragraph using `AZURE_DEPLOYMENT_DEFAULT` (`gpt-5.4`, non-pro). Hash-gated via `final_score_change_detection_for_developer` — covers 3 upstream score cells.

---

## Exa output schema

All structured Exa stages (Digital Native, Cloud Tool, Funding Growth, Revenue Growth, Number of Users, Industry) use `outputSchema` (object with `companies[]`). Parsers read `raw.output.content` as a parsed object. AI Adoption Mindset and AI SRE Maturity use `outputSchema: { type: 'text' }` and read `raw.output.content` as a verbatim string.

---

## API mapping

| Stage | Column | API |
|---|---|---|
| 1 | Competitor Tooling | local match + TheirStack |
| 2 | Digital Native | Exa (batch-of-2) |
| 3 | Number of Users | Exa (batch-of-2) |
| 4 | Observability Tool | Exa (batch-of-2) |
| 5 | Communication Tool | TheirStack (per-company, 2 sequential calls) |
| 6 | Cloud Tool | Exa (batch-of-2) |
| 7 | Funding Growth | Exa (batch-of-2) |
| 8 | Revenue Growth | Exa (batch-of-2) |
| 9 | Number of Engineers | Apollo |
| 10 | Number of SREs | Apify harvestapi/linkedin-company-employees |
| 11+12 | Engineer Hiring + SRE Hiring | Apify fantastic-jobs/career-site-job-listing-feed (single call) |
| 13 | Customer complains on X | twitterapi.io + Azure OpenAI (4-bucket classifier) |
| 14 | Recent incidents | Statuspage v2 (no auth, no OpenAI) |
| 15 | AI adoption mindset | Exa per-company, text outputSchema |
| 16 | AI SRE maturity | Exa per-company, text outputSchema |
| 17 | Industry | Exa (batch-of-2), structured JSON enum |
| 18 | Company Context Score | Azure OpenAI gpt-5.4-pro, hash-gated |
| 19 | Tooling Match Score | Azure OpenAI gpt-5.4-pro, hash-gated |
| 20 | Intent Signal Score | Azure OpenAI gpt-5.4-pro, hash-gated |
| 21 | Final Score | local formula + Azure OpenAI gpt-5.4 (reasoning only), hash-gated |
