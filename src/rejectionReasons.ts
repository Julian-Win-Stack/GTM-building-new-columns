import type { DigitalNativeData } from './stages/digitalNative.js';
import type { ObservabilityToolData } from './stages/observabilityTool.js';
import type { CommunicationToolData } from './stages/communicationTool.js';
import type { CloudToolData } from './stages/cloudTool.js';

export function digitalNativeRejectionReason(_d: DigitalNativeData): string {
  return 'Digital Native: not a digital-native company';
}

export function digitalNativeCacheRejectionReason(_cached: string): string {
  return 'Digital Native: not a digital-native company';
}

export function numberOfUsersRejectionReason(bucket: string): string {
  return `Number of Users: B2B company in "${bucket}" bucket (requires 100K+)`;
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
