import type { GateRule, StageCompany, StageResult } from './types.js';

export type CommunicationTool = 'Slack' | 'Microsoft Teams' | null;

export type CommunicationToolData = {
  tool: CommunicationTool;
  sourceUrl: string | null;
};

export type CommunicationToolRaw = {
  domain: string;
  tool: CommunicationTool;
  sourceUrl: string | null;
};

export function parseCommunicationToolResponse(
  raw: CommunicationToolRaw,
  companies: StageCompany[]
): StageResult<CommunicationToolData>[] {
  const company = companies[0];
  if (!company) return [];
  return [{ company, data: { tool: raw.tool, sourceUrl: raw.sourceUrl } }];
}

export const communicationToolGate: GateRule<CommunicationToolData> = (d) =>
  d.tool !== 'Microsoft Teams';

export function formatCommunicationToolForAttio(d: CommunicationToolData): string {
  if (d.tool === null) return 'No evidence found';
  return `${d.tool}: ${d.sourceUrl ?? ''}`;
}

export const communicationToolCacheGate = (cached: string): boolean => {
  const trimmed = cached.trim().toLowerCase();
  if (!trimmed) return false;
  return !trimmed.startsWith('microsoft teams');
};
