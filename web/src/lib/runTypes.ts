// Frontend-side type mirror of src/runTypes.ts.
// Kept in sync manually — only the parts the frontend consumes (no RunEvent union, no RunCtx).

export type ActivityEntry = {
  ts: number;
  domain: string;
  companyName: string;
  column: string;
  kind: 'cell' | 'reject';
};

// What `GET /api/runs/:id/state` returns. The polling hook stores this directly as state.
export type RunStateSnapshot = {
  status: 'idle' | 'starting' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';
  error?: string;
  totalCompanies: number;
  skippedRows: Array<{ name: string; reason: string }>;
  currentStage?: { stageNumber: number; stageName: string; todo: number; skipped: number };
  stagesCompleted: number;
  completedStageNames: string[];
  recentActivity: ActivityEntry[];
  lastEventAt?: number;
  surviving?: number;
  rejected?: number;
  errored?: number;
};
