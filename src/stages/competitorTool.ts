import type { GateRule } from './types.js';

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
    'Netflix', 'Etsy', 'Skyscanner', 'Vanta', 'Intercom', 'WorkOS', 'Miro',
    'HashiCorp', 'StubHub', 'Linear', 'Render', 'Loom', 'GoCardless', 'Ramp',
    'Vercel', 'dbt Labs', 'Pipe', 'Duffel', 'Primer', 'Netlify', 'TravelPerk',
    'monday.com',
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

export type CompetitorToolData = {
  matchedTools: string[];
};

export function matchCompetitorTools(companyName: string | undefined): string[] {
  if (!companyName) return [];
  const normalized = companyName.trim().toLowerCase();
  if (!normalized) return [];
  const matches: string[] = [];
  for (const [tool, companies] of Object.entries(COMPETITOR_TOOLS)) {
    if (companies.some((c) => c.toLowerCase() === normalized)) {
      matches.push(tool);
    }
  }
  return matches;
}

export const competitorToolGate: GateRule<CompetitorToolData> = (d) =>
  d.matchedTools.length === 0;

export function formatCompetitorToolForAttio(d: CompetitorToolData): string {
  if (d.matchedTools.length === 0) return 'Not using any competitor tools';
  const evidence = d.matchedTools.map((t) => `Evidence: (${t}'s customer page)`).join('\n');
  return `${d.matchedTools.join(', ')}\n\n${evidence}`;
}

export const competitorToolCacheGate = (cached: string): boolean =>
  cached.trim() === 'Not using any competitor tools';

export function extractMatchedToolsFromCached(cached: string): string[] {
  const firstLine = cached.trim().split('\n')[0]?.trim() ?? '';
  if (!firstLine || firstLine === 'Not using any competitor tools') return [];
  return firstLine.split(',').map((s) => s.trim()).filter(Boolean);
}
