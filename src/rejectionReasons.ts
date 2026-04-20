import type { CompetitorToolData } from './stages/competitorTool.js';
import type { DigitalNativeData } from './stages/digitalNative.js';
import type { ObservabilityToolData } from './stages/observabilityTool.js';
import type { CommunicationToolData } from './stages/communicationTool.js';
import type { CloudToolData } from './stages/cloudTool.js';

export function competitorToolRejectionReason(d: CompetitorToolData): string {
  return `Competitor Tooling: using ${d.matchedTools.join(', ')}`;
}

export function competitorToolCacheRejectionReason(cached: string): string {
  return `Competitor Tooling: using ${cached.trim()}`;
}

export function digitalNativeRejectionReason(_d: DigitalNativeData): string {
  return 'Digital Native: not a digital-native company';
}

export function digitalNativeCacheRejectionReason(_cached: string): string {
  return 'Digital Native: not a digital-native company';
}

export function numberOfUsersRejectionReason(numeric: number): string {
  const formatted = numeric.toLocaleString('en-US');
  return `Number of Users: B2B company with ${formatted} users (requires ≥100,000)`;
}

export function observabilityToolRejectionReason(d: ObservabilityToolData): string {
  const names = d.tools.map((t) => t.name).join(', ');
  return `Observability Tool: uses ${names} (not Datadog/Grafana/Prometheus)`;
}

export function observabilityToolCacheRejectionReason(cached: string): string {
  const trimmed = cached.trim();
  const toolNames = trimmed
    .split('\n')
    .map((line) => line.split(':')[0]?.trim() ?? '')
    .filter(Boolean);
  const names = toolNames.length > 0 ? toolNames.join(', ') : 'unknown tools';
  return `Observability Tool: uses ${names} (not Datadog/Grafana/Prometheus)`;
}

export function communicationToolRejectionReason(_d: CommunicationToolData): string {
  return 'Communication Tool: uses Microsoft Teams';
}

export function communicationToolCacheRejectionReason(_cached: string): string {
  return 'Communication Tool: uses Microsoft Teams';
}

export function cloudToolRejectionReason(d: CloudToolData): string {
  return `Cloud Tool: uses ${d.tool} (not AWS/GCP)`;
}

export function cloudToolCacheRejectionReason(cached: string): string {
  const trimmed = cached.trim();
  const toolName = trimmed ? (trimmed.split(':')[0]?.trim() ?? 'unknown cloud') : 'unknown cloud';
  return `Cloud Tool: uses ${toolName} (not AWS/GCP)`;
}
