import { useEffect, useRef, useState } from 'react';
import type { ActivityEntry, RunStateSnapshot } from './runTypes.js';

// Re-export for any consumer that used the old name.
export type { ActivityEntry };
export type RunStreamState = RunStateSnapshot;

const POLL_INTERVAL_MS = 1000;

const initial: RunStateSnapshot = {
  status: 'idle',
  totalCompanies: 0,
  skippedRows: [],
  stagesCompleted: 0,
  completedStageNames: [],
  recentActivity: [],
};

export type RunStreamHandle = {
  state: RunStateSnapshot;
  cancel: () => Promise<void>;
};

// Polls `GET /api/runs/:id/state` every second and exposes the latest snapshot. Replaces
// the old SSE stream — short-lived requests are more robust on flaky networks (cafés,
// mobile tethering, corporate proxies) than long-lived connections.
//
// Stops polling automatically once the run reaches a terminal status (completed / cancelled
// / failed). The Cancel button optimistically transitions to 'cancelling' so the UI reacts
// instantly without waiting for the next poll.
export function useRunStream(runId: string | null): RunStreamHandle {
  const [state, setState] = useState<RunStateSnapshot>(initial);
  // Whenever the user clicks Cancel we hold the UI in 'cancelling' until the server's poll
  // confirms the cancellation. Without this hold, the next poll (if it lands before the
  // server has processed the cancel POST) would briefly flip the UI back to 'running'.
  const optimisticCancellingRef = useRef(false);

  useEffect(() => {
    if (!runId) {
      setState(initial);
      optimisticCancellingRef.current = false;
      return;
    }

    setState({ ...initial, status: 'starting' });
    optimisticCancellingRef.current = false;

    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (stopped) return;
      try {
        const res = await fetch(`/api/runs/${runId}/state`);
        if (stopped) return;
        if (res.ok) {
          const next = (await res.json()) as RunStateSnapshot;
          // Hold optimistic 'cancelling' until the server agrees — prevents a "running"
          // flicker if the cancel POST hasn't been processed by the time the next poll fires.
          if (
            optimisticCancellingRef.current &&
            (next.status === 'running' || next.status === 'starting')
          ) {
            next.status = 'cancelling';
          }
          if (
            next.status === 'completed' ||
            next.status === 'cancelled' ||
            next.status === 'failed'
          ) {
            optimisticCancellingRef.current = false;
          }
          setState(next);
          if (
            next.status === 'completed' ||
            next.status === 'cancelled' ||
            next.status === 'failed'
          ) {
            return; // stop polling — terminal state
          }
        }
      } catch {
        // network blip — just retry on the next tick
      }
      if (!stopped) timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
    }

    void tick();

    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [runId]);

  async function cancel(): Promise<void> {
    if (!runId) return;
    optimisticCancellingRef.current = true;
    setState((s) => ({ ...s, status: 'cancelling' }));
    try {
      await fetch(`/api/runs/${runId}/cancel`, { method: 'POST' });
    } catch (err) {
      console.error('cancel request failed', err);
    }
  }

  return { state, cancel };
}
