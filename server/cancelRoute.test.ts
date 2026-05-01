import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Pre-import env setup — must run before any module is loaded so the server
// (a) skips its real listen, (b) writes upload/snapshot data into temp dirs,
// (c) doesn't crash on missing API keys. vi.hoisted runs before imports, so
// we can't use path/os here — hardcode tmp paths.
vi.hoisted(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['UPLOAD_DIR'] = '/tmp/cancel-route-test/uploads';
  // Fake secrets so config.ts doesn't throw when enrichAll is imported transitively.
  process.env['ATTIO_API_KEY'] = 'test-attio';
  process.env['EXA_API_KEY'] = 'test-exa';
  process.env['THEIRSTACK_API_KEY'] = 'test-theirstack';
  process.env['APOLLO_API_KEY'] = 'test-apollo';
  process.env['APIFY_TOKEN'] = 'test-apify';
  process.env['AZURE_OPENAI_API_KEY'] = 'test-openai';
  process.env['AZURE_OPENAI_BASE_URL'] = 'https://test.openai.azure.com';
  process.env['AZURE_OPENAI_DEPLOYMENT'] = 'test-deployment';
  process.env['X_API_KEY'] = 'test-x';
});

const { app } = await import('./index.js');
const { createRun, getRun } = await import('./runRegistry.js');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Listen on port 0 → kernel picks a free port.
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/runs/:id/cancel — HTTP boundary', () => {
  it('flips cancelRequested, rejects cancelSignal, and exposes status="cancelling" via /state', async () => {
    const run = createRun('cancel-test-run', {});
    // Promote out of 'starting' so requestCancel acts on a "running" run, mirroring
    // production where the route is hit after run-started has fired.
    run.status = 'running';

    // Watch the cancelSignal — the pipeline relies on this rejecting, not just
    // on cancelRequested flipping. Capture the rejection without leaking an
    // unhandled-rejection warning.
    let signalRejected = false;
    run.cancelSignal.catch(() => {
      signalRejected = true;
    });

    const cancelResp = await fetch(`${baseUrl}/api/runs/cancel-test-run/cancel`, { method: 'POST' });
    expect(cancelResp.status).toBe(200);
    expect(await cancelResp.json()).toEqual({ ok: true });

    expect(getRun('cancel-test-run')?.cancelRequested).toBe(true);

    // Yield so the cancelSignal rejection propagates to the .catch handler.
    await new Promise((resolve) => setImmediate(resolve));
    expect(signalRejected).toBe(true);

    const stateResp = await fetch(`${baseUrl}/api/runs/cancel-test-run/state`);
    expect(stateResp.status).toBe(200);
    const snapshot = (await stateResp.json()) as { status: string };
    expect(snapshot.status).toBe('cancelling');
  });

  it('returns 404 when run does not exist', async () => {
    const resp = await fetch(`${baseUrl}/api/runs/does-not-exist/cancel`, { method: 'POST' });
    expect(resp.status).toBe(404);
  });

  it('returns 409 when run is already finished', async () => {
    const run = createRun('finished-run', {});
    run.status = 'completed';

    const resp = await fetch(`${baseUrl}/api/runs/finished-run/cancel`, { method: 'POST' });
    expect(resp.status).toBe(409);
  });
});
