import type { ActivityEntry, RunEvent, RunStateSnapshot } from '../src/runTypes.js';

type RunStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';

const ACTIVITY_BUFFER_SIZE = 12;

export type RunRecord = {
  id: string;
  status: RunStatus;
  createdAt: number;
  finishedAt?: number;
  cache?: Map<string, Record<string, string>>;
  error?: string;
  cancelRequested: boolean;
  // Promise that *only ever rejects* — racing API calls against it makes them throw on cancel.
  cancelSignal: Promise<never>;
  // Captured reject() of cancelSignal. Called once on /cancel to flip the signal.
  triggerCancel: () => void;
  // Public state (everything below is what serializeRun returns).
  companyNames: Map<string, string>;
  accountPurpose?: string;
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

const runs = new Map<string, RunRecord>();

export function createRun(id: string, opts: { accountPurpose?: string }): RunRecord {
  let triggerCancel: () => void = () => {};
  const cancelSignal = new Promise<never>((_, reject) => {
    triggerCancel = () => reject(new Error('run cancelled'));
  });
  // Attach a no-op catch so V8 doesn't print an unhandled-rejection warning when the run
  // finishes normally and the signal is discarded still pending.
  cancelSignal.catch(() => {});
  const record: RunRecord = {
    id,
    status: 'starting',
    createdAt: Date.now(),
    cancelRequested: false,
    cancelSignal,
    triggerCancel,
    companyNames: new Map(),
    accountPurpose: opts.accountPurpose,
    totalCompanies: 0,
    skippedRows: [],
    stagesCompleted: 0,
    completedStageNames: [],
    recentActivity: [],
  };
  runs.set(id, record);
  return record;
}

export function requestCancel(id: string): boolean {
  const run = runs.get(id);
  if (!run) {
    console.warn(`[cancel] requestCancel called for unknown run ${id}`);
    return false;
  }
  if (run.status !== 'running' && run.status !== 'starting') {
    console.warn(`[cancel] requestCancel called for run ${id} in status=${run.status}`);
    return false;
  }
  if (!run.cancelRequested) {
    run.cancelRequested = true;
    run.triggerCancel();
    console.log(`[cancel] run ${id} cancelRequested=true, cancelSignal rejected`);
  }
  return true;
}

export function isRunCancelled(id: string): boolean {
  return runs.get(id)?.cancelRequested ?? false;
}

export function getRun(id: string): RunRecord | undefined {
  return runs.get(id);
}

// Update the public state of a run from a single pipeline event. Replaces the old SSE
// subscriber fan-out — the frontend now polls serializeRun(), so all we have to do is
// keep the run record in sync.
export function appendEvent(id: string, event: RunEvent): void {
  const run = runs.get(id);
  if (!run) return;

  switch (event.type) {
    case 'run-started': {
      run.status = 'running';
      run.totalCompanies = event.totalCompanies;
      run.skippedRows = event.skippedRows;
      run.companyNames = new Map(event.companies.map((c) => [c.domain, c.companyName]));
      break;
    }
    case 'stage-started': {
      run.currentStage = {
        stageNumber: event.stageNumber,
        stageName: event.stageName,
        todo: event.todo,
        skipped: event.skipped,
      };
      break;
    }
    case 'stage-completed': {
      run.stagesCompleted = Math.max(run.stagesCompleted, event.stageNumber);
      if (!run.completedStageNames.includes(event.stageName)) {
        run.completedStageNames.push(event.stageName);
      }
      break;
    }
    case 'cell-updated': {
      const companyName = run.companyNames.get(event.domain) ?? event.domain;
      const now = Date.now();
      run.recentActivity.unshift({
        ts: now,
        domain: event.domain,
        companyName,
        column: event.column,
        kind: 'cell',
      });
      if (run.recentActivity.length > ACTIVITY_BUFFER_SIZE) {
        run.recentActivity.length = ACTIVITY_BUFFER_SIZE;
      }
      run.lastEventAt = now;
      break;
    }
    case 'company-rejected': {
      const companyName = run.companyNames.get(event.domain) ?? event.domain;
      const now = Date.now();
      run.recentActivity.unshift({
        ts: now,
        domain: event.domain,
        companyName,
        column: `Rejected: ${event.reason}`,
        kind: 'reject',
      });
      if (run.recentActivity.length > ACTIVITY_BUFFER_SIZE) {
        run.recentActivity.length = ACTIVITY_BUFFER_SIZE;
      }
      run.lastEventAt = now;
      break;
    }
    case 'run-completed': {
      run.surviving = event.surviving;
      run.rejected = event.rejected;
      run.errored = event.errored;
      // status is finalized in completeRun() so the cancel-vs-complete decision happens in
      // one place; just record the counts here.
      break;
    }
    case 'run-cancelled': {
      // Handled by completeRun (which checks cancelRequested). No-op here.
      break;
    }
    case 'run-failed': {
      run.error = event.error;
      // status is finalized in failRun().
      break;
    }
  }
}

export function completeRun(id: string, cache: Map<string, Record<string, string>>): void {
  const run = runs.get(id);
  if (!run) return;
  run.status = run.cancelRequested ? 'cancelled' : 'completed';
  run.finishedAt = Date.now();
  run.cache = cache;
}

export function failRun(id: string, error: string): void {
  const run = runs.get(id);
  if (!run) return;
  run.status = 'failed';
  run.finishedAt = Date.now();
  run.error = error;
}

export function deleteOldRuns(maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;
  for (const [id, run] of runs) {
    // Only sweep *finished* runs older than cutoff. A still-running pipeline (createdAt is old
    // but finishedAt is undefined) must not be evicted, otherwise long runs (>1h) would lose
    // their in-memory state mid-pipeline.
    if (run.finishedAt === undefined) continue;
    if (run.finishedAt < cutoff) {
      runs.delete(id);
      deleted++;
    }
  }
  return deleted;
}

// Serialize a RunRecord into the JSON shape the frontend's polling hook expects. Note the
// status-mapping: while a cancel is in progress (cancelRequested + still-running internally),
// expose it as 'cancelling' to the UI so the cancel button can show its waiting state.
export function serializeRun(run: RunRecord): RunStateSnapshot {
  const exposed: RunStateSnapshot['status'] =
    run.cancelRequested && (run.status === 'running' || run.status === 'starting')
      ? 'cancelling'
      : run.status;
  const snapshot: RunStateSnapshot = {
    status: exposed,
    totalCompanies: run.totalCompanies,
    skippedRows: run.skippedRows,
    stagesCompleted: run.stagesCompleted,
    completedStageNames: run.completedStageNames,
    recentActivity: run.recentActivity,
  };
  if (run.error !== undefined) snapshot.error = run.error;
  if (run.currentStage) snapshot.currentStage = run.currentStage;
  if (run.lastEventAt !== undefined) snapshot.lastEventAt = run.lastEventAt;
  if (run.surviving !== undefined) snapshot.surviving = run.surviving;
  if (run.rejected !== undefined) snapshot.rejected = run.rejected;
  if (run.errored !== undefined) snapshot.errored = run.errored;
  return snapshot;
}
