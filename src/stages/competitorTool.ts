import type { TheirstackJob } from '../apis/theirstack.js';

export const COMPETITOR_TOOLS: Record<string, readonly string[]> = {
  'Resolve.ai': [
    'Coinbase', 'DoorDash', 'Salesforce', 'MongoDB', 'Zscaler', 'Gametime',
    'MSCI', 'Toast', 'Pinecone', 'Guidewire', 'Blueground', 'Modal',
    'Fireworks AI', 'Upwind', 'Veza',
  ],
  'Rootly': [
    'Wealthsimple', 'Clay', 'Motive', 'Lucidworks', 'Replit', 'Achievers',
    'Webflow', 'Upstart', 'KnowBe4', 'ROLLER', 'Momentum', 'Nylas',
    'Taplytics', 'Ritual',
  ],
  'Incident.io': [
    'Intercom', 'Netflix', 'Etsy', 'Flagstone', 'Torq', 'Rho', 'Favor',
    'Buffer', 'AudioStack', 'Motorway', 'Picnic', 'Skyscanner', 'Thrive',
    'SumUp', 'Clari', 'Vanta', 'Trainline', 'Pleo', 'Isometric', 'TrueLayer',
    'Bold Commerce', 'Bud', 'WorkOS', 'RD Station', 'Giant Swarm', 'Future',
    'ComplyAdvantage', 'Accurx',
  ],
  'Traversal': [
    'DigitalOcean', 'Cloudways', 'American Express', 'Pepsi',
  ],
  'TierZero': [
    'Brex', 'Discord', 'Drata', 'Framer', 'Eaze', 'WeightWatchers',
    'Weight Watchers', 'Aerospace', 'Modern Loop', 'ModrenLoop',
  ],
  'RunLLM': [
    'Databricks', 'LlamaIndex', 'DataHub', 'Corelight', 'StreamNative',
    'Monte Carlo', 'MotherDuck', 'Embrace', 'Eppo', 'Arize', 'DSPy', 'vLLM',
  ],
  'Neubird': [
    'Agero', 'Model Rocket', 'KAI AI', 'DeepHealth', 'Everpure',
    'Pure Storage', 'Commonwealth Bank',
  ],
  'Wildmoose': [
    'Wix', 'Redis', 'GoFundMe', 'Go Fund Me',
  ],
};

export const COMPETITOR_THEIRSTACK_SLUGS = ['komodor', 'mezmo', 'rootly-slack'] as const;
type CompetitorTheirStackSlug = typeof COMPETITOR_THEIRSTACK_SLUGS[number];

const THEIRSTACK_SLUG_TO_TOOL: Record<CompetitorTheirStackSlug, string> = {
  'komodor': 'Komodor',
  'mezmo': 'Mezmo',
  'rootly-slack': 'Rootly',
};

export type CompetitorToolEvidence =
  | { type: 'customer_page' }
  | { type: 'theirstack'; sourceUrl: string };

export type CompetitorToolData = {
  matchedTools: string[];
  evidence: Record<string, CompetitorToolEvidence>;
};

export function matchCompetitorTools(companyName: string | undefined): CompetitorToolData {
  if (!companyName) return { matchedTools: [], evidence: {} };
  const normalized = companyName.trim().toLowerCase();
  if (!normalized) return { matchedTools: [], evidence: {} };
  const matchedTools: string[] = [];
  const evidence: Record<string, CompetitorToolEvidence> = {};
  for (const [tool, companies] of Object.entries(COMPETITOR_TOOLS)) {
    if (companies.some((c) => c.toLowerCase() === normalized)) {
      matchedTools.push(tool);
      evidence[tool] = { type: 'customer_page' };
    }
  }
  return { matchedTools, evidence };
}

export function detectCompetitorToolsFromTheirStack(job: TheirstackJob): string[] {
  const slugSet = new Set((job.technology_slugs ?? []).map((s) => s.toLowerCase()));
  const nameSet = new Set((job.technology_names ?? []).map((n) => n.toLowerCase()));
  const detected: string[] = [];
  for (const slug of COMPETITOR_THEIRSTACK_SLUGS) {
    if (slugSet.has(slug) || nameSet.has(slug)) {
      detected.push(THEIRSTACK_SLUG_TO_TOOL[slug]);
    }
  }
  return detected;
}

export function formatCompetitorToolForAttio(d: CompetitorToolData): string {
  if (d.matchedTools.length === 0) return 'Not using any competitor tools';
  const evidenceLines = d.matchedTools.map((t) => {
    const ev = d.evidence[t];
    if (!ev || ev.type === 'customer_page') return `Evidence: (${t}'s customer page)`;
    return `Evidence: ${ev.sourceUrl}`;
  }).join('\n');
  return `${d.matchedTools.join(', ')}\n\n${evidenceLines}`;
}
