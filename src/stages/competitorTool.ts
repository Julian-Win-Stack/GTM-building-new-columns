import type { GateRule } from './types.js';

export const COMPETITOR_TOOLS: Record<string, readonly string[]> = {
  'Resolve.ai': [
    'Coinbase', 'Zscaler', 'DoorDash', 'MongoDB', 'MSCI', 'Salesforce',
    'DataStax', 'Blueground', 'Tubi', 'Rappi',
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
  'FireHydrant': [
    'AuditBoard', 'Snyk', 'Qlik', 'Recharge', 'Bluecore', 'LaunchDarkly',
  ],
  'PagerDuty': [
    'Picnic', 'Jeppesen', 'Wehkamp', 'SendGrid', 'REA Group', 'Cloudflare',
    'TUI', 'BukuWarung', 'Ryanair', 'Anaplan', 'Guidewire', 'Specsavers',
    'Fox Corporation', 'IBM', 'GE', 'Capital One', 'American Eagle Outfitters',
    'Pitney Bowes', 'Box', 'ING', 'Comcast', 'eHarmony', 'Slack', 'Lululemon',
    'Twilio', 'Airbnb', 'Zoom',
  ],
  'Opsgenie': [
    'Overstock', 'Looker', 'Zendesk', 'Dynatrace', 'EBSCO', 'Air Canada',
    'The Washington Post', 'Yahoo', 'Politico', 'SolarWinds',
    'Oregon State University', 'Glassdoor', 'Cloudticity', 'Unbounce',
    'Bleacher Report', 'iFood',
  ],
  'xMatters': [
    'Kroger', 'ViaSat', 'Constant Contact', 'BMC', 'American Airlines',
    'Athenahealth', 'O2', 'Tesco', 'WesCEF', 'NBN Co',
    'Intermountain Healthcare', 'Pacific Life', 'Kellogg', 'Principal',
    'Accenture', 'Credigy',
  ],
  'Splunk On-Call': [
    'NVIDIA', 'Cisco', 'NBC', 'Rackspace', 'Intuit', 'DirecTV', 'NASCAR',
    'Arrow Electronics', 'Alliance Health', 'NetApp', 'Edmunds',
    'New York Times', 'Return Path', 'Sony PlayStation', 'CA Technologies',
    'Sphero', 'Symantec', 'HBO', 'Weatherford', 'Blackboard', 'Epic Games',
  ],
  'BigPanda': [
    'IHG Hotels & Resorts', 'New York Stock Exchange (NYSE)', 'Playtika',
    'FreeWheel (Comcast)', 'WEC Energy Group', 'Autodesk', 'Zayo', 'GAP',
    'Intel', 'Cisco', 'United Airlines', 'Abbott', 'Marriott', 'Expedia',
  ],
  'Moogsoft': [
    'Verizon Media', 'Qualcomm', 'Fannie Mae', 'GoDaddy', 'KeyBank',
    'HCL Technologies', 'SAP SuccessFactors', 'Fiserv', 'American Airlines',
    'INRIX', 'Yahoo', 'Intuit', 'Worldpay',
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
  return d.matchedTools.join(', ');
}
