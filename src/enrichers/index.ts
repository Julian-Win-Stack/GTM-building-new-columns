import type { EnrichableColumn, EnricherFn } from '../types.js';

// -----------------------------------------------------------------------------
// Per-column enricher stubs.
//
// Each enricher is responsible for computing the value of ONE output column
// given the company inputs (name, domain, website, linkedinUrl).
//
// Wiring plan (fill in as per-API details arrive):
//   - Exa-heavy columns:     Digital-native, Cloud Tool, Communication Tool, Observability Tool
//   - Apify + OpenAI:        Number of Users, Recent Incidents, AI-forward Organization,
//                            AI Reliability Keyword Signals, Competitor Tooling
//   - TheirStack:            Engineer Hiring, SRE Hiring
//   - OpenAI + web search:   Funding Growth, Revenue Growth
// -----------------------------------------------------------------------------

const digitalNative: EnricherFn = async (_input) => '';
const cloudTool: EnricherFn = async (_input) => '';
const observabilityTool: EnricherFn = async (_input) => '';
const communicationTool: EnricherFn = async (_input) => '';
const numberOfUsers: EnricherFn = async (_input) => '';
const competitorTooling: EnricherFn = async (_input) => '';
const engineerHiring: EnricherFn = async (_input) => '';
const sreHiring: EnricherFn = async (_input) => '';
const recentIncidents: EnricherFn = async (_input) => '';
const fundingGrowth: EnricherFn = async (_input) => '';
const revenueGrowth: EnricherFn = async (_input) => '';
const aiForwardOrganization: EnricherFn = async (_input) => '';
const aiReliabilityKeywordSignals: EnricherFn = async (_input) => '';

export const ENRICHERS: Record<EnrichableColumn, EnricherFn> = {
  'Digital-native (Exa)': digitalNative,
  'Cloud Tool (Exa)': cloudTool,
  'Observability Tool': observabilityTool,
  'Communication Tool (Exa)': communicationTool,
  'Number of Users': numberOfUsers,
  'Competitor Tooling': competitorTooling,
  'Engineer Hiring': engineerHiring,
  'SRE Hiring': sreHiring,
  'Recent Incidents': recentIncidents,
  'Funding Growth': fundingGrowth,
  'Revenue Growth': revenueGrowth,
  'AI-forward Organization': aiForwardOrganization,
  'AI Reliability Keyword Signals': aiReliabilityKeywordSignals,
};

export const ENRICHABLE_COLUMN_LIST = Object.keys(ENRICHERS) as EnrichableColumn[];
