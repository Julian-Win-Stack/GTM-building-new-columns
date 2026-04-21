import type { EnrichableColumn, EnricherFn } from '../types.js';

const digitalNative: EnricherFn = async (_input) => '';
const cloudTool: EnricherFn = async (_input) => '';
const observabilityTool: EnricherFn = async (_input) => '';
const communicationTool: EnricherFn = async (_input) => '';
const numberOfUsers: EnricherFn = async (_input) => '';
const competitorTooling: EnricherFn = async (_input) => '';
const numberOfEngineers: EnricherFn = async (_input) => '';
const numberOfSres: EnricherFn = async (_input) => '';
const engineerHiring: EnricherFn = async (_input) => '';
const sreHiring: EnricherFn = async (_input) => '';
const customerComplainsOnX: EnricherFn = async (_input) => '';
const recentIncidents: EnricherFn = async (_input) => '';
const fundingGrowth: EnricherFn = async (_input) => '';
const revenueGrowth: EnricherFn = async (_input) => '';
const aiAdoptionMindset: EnricherFn = async (_input) => '';
const aiSreMaturity: EnricherFn = async (_input) => '';
const industry: EnricherFn = async (_input) => '';
const companyContextScore: EnricherFn = async (_input) => '';
const toolingMatchScore: EnricherFn = async (_input) => '';
const intentSignalScore: EnricherFn = async (_input) => '';
const finalScore: EnricherFn = async (_input) => '';
const reasonForRejection: EnricherFn = async (_input) => '';

export const ENRICHERS: Record<EnrichableColumn, EnricherFn> = {
  'Digital Native': digitalNative,
  'Cloud Tool': cloudTool,
  'Observability Tool': observabilityTool,
  'Communication Tool': communicationTool,
  'Number of Users': numberOfUsers,
  'Competitor Tooling': competitorTooling,
  'Number of Engineers': numberOfEngineers,
  'Number of SREs': numberOfSres,
  'Engineer Hiring': engineerHiring,
  'SRE Hiring': sreHiring,
  'Customer complains on X': customerComplainsOnX,
  'Recent incidents ( Official )': recentIncidents,
  'Funding Growth': fundingGrowth,
  'Revenue Growth': revenueGrowth,
  'AI adoption mindset': aiAdoptionMindset,
  'AI SRE maturity': aiSreMaturity,
  'Industry': industry,
  'Company Context Score': companyContextScore,
  'Tooling Match Score': toolingMatchScore,
  'Intent Signal Score': intentSignalScore,
  'Final Score': finalScore,
  'Reason for Rejection': reasonForRejection,
};

export const ENRICHABLE_COLUMN_LIST = Object.keys(ENRICHERS) as EnrichableColumn[];
