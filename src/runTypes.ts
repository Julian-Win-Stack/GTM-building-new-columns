export type RunEvent =
  | {
      type: 'run-started';
      totalCompanies: number;
      companies: Array<{
        domain: string;
        companyName: string;
        website?: string;
        description?: string;
        linkedinUrl?: string;
        apolloId?: string;
        accountPurpose?: string;
      }>;
      skippedRows: Array<{ name: string; reason: string }>;
    }
  | { type: 'stage-started'; stageNumber: number; stageName: string; todo: number; skipped: number }
  | { type: 'stage-completed'; stageNumber: number; stageName: string }
  | { type: 'cell-updated'; domain: string; column: string; value: string }
  | { type: 'company-rejected'; domain: string; reason: string }
  | { type: 'run-completed'; surviving: number; rejected: number; errored: number }
  | { type: 'run-cancelled' }
  | { type: 'run-failed'; error: string };

export type RunCtx = {
  writeToAttio: boolean;
  emit: (event: RunEvent) => void;
  // Hard cancellation. `isCancelled` is polled between stages and at the start of each batch.
  // `cancelSignal` is a promise that rejects when the user clicks Cancel — pipeline code races
  // every API await against it so in-flight HTTP requests are abandoned (no waiting for them to
  // resolve). CLI runs omit both (run completes normally).
  isCancelled?: () => boolean;
  cancelSignal?: Promise<never>;
};

export const NOOP_RUN_CTX: RunCtx = {
  writeToAttio: true,
  emit: () => {},
};

// Race a promise against a cancellation signal. If the signal rejects first, the awaiter throws
// 'cancelled' immediately — the underlying socket may stay open in the background but the
// pipeline stops waiting. Callers must handle the throw (typically by short-circuiting to an
// errored result).
export function raceCancel<T>(p: Promise<T>, signal?: Promise<never>): Promise<T> {
  return signal ? Promise.race([p, signal]) : p;
}

// One entry in the rolling "recent activity" feed shown in the UI. The server keeps the
// last 12 of these in the run record and returns them on every poll.
export type ActivityEntry = {
  ts: number;
  domain: string;
  companyName: string;
  column: string;
  kind: 'cell' | 'reject';
};

// What `GET /api/runs/:id/state` returns. The frontend polls this once per second and
// renders directly off the latest payload — no event reducer, no event-cursor tracking.
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
