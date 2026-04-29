import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Per-run cache snapshots written to disk so a server crash / Railway redeploy doesn't lose
// in-flight work in CSV-only mode. On Railway, point SNAPSHOT_DIR at a mounted volume
// (e.g. /data/runs) so files survive redeploys. Locally falls back to tmp/runs/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DIR = path.join(PROJECT_ROOT, 'tmp', 'runs');
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? DEFAULT_DIR;

let initPromise: Promise<void> | null = null;
async function ensureDir(): Promise<void> {
  if (!initPromise) initPromise = fs.mkdir(SNAPSHOT_DIR, { recursive: true }).then(() => {});
  return initPromise;
}

export type SnapshotPayload = {
  // Schema version so future format changes can be migrated rather than crashing recovery.
  version: 1;
  runId: string;
  savedAt: number;
  // Source CSV's company-domain set, used to match a re-uploaded CSV to this snapshot.
  domains: string[];
  accountPurpose?: string;
  writeToAttio: boolean;
  // The number of stages whose stage-completed event has been observed.
  stagesCompleted: number;
  completedStageNames: string[];
  // The actual cache data: domain → slug → value.
  cache: Record<string, Record<string, string>>;
};

function snapshotPath(runId: string): string {
  return path.join(SNAPSHOT_DIR, `${runId}.json`);
}

export async function writeSnapshot(payload: SnapshotPayload): Promise<void> {
  await ensureDir();
  const tmp = `${snapshotPath(payload.runId)}.tmp`;
  const final = snapshotPath(payload.runId);
  // Atomic write: write to temp, fsync on rename. Prevents a half-written snapshot if the
  // process dies mid-flush.
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8');
  await fs.rename(tmp, final);
}

export async function loadSnapshot(runId: string): Promise<SnapshotPayload | null> {
  try {
    const text = await fs.readFile(snapshotPath(runId), 'utf8');
    const parsed = JSON.parse(text) as SnapshotPayload;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`[snapshotStore] failed to load ${runId}:`, err);
    return null;
  }
}

export async function deleteSnapshot(runId: string): Promise<void> {
  try {
    await fs.unlink(snapshotPath(runId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[snapshotStore] failed to delete ${runId}:`, err);
    }
  }
}

export async function listSnapshots(): Promise<SnapshotPayload[]> {
  await ensureDir();
  let entries: string[];
  try {
    entries = await fs.readdir(SNAPSHOT_DIR);
  } catch {
    return [];
  }
  const payloads: SnapshotPayload[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const runId = entry.slice(0, -'.json'.length);
    const p = await loadSnapshot(runId);
    if (p) payloads.push(p);
  }
  return payloads;
}

// Returns the most recently-saved snapshot whose domain set matches the supplied list (order
// doesn't matter; equality is set-equality). Returns null if nothing matches.
export async function findResumableSnapshot(domains: string[]): Promise<SnapshotPayload | null> {
  const target = new Set(domains);
  const all = await listSnapshots();
  let best: SnapshotPayload | null = null;
  for (const snap of all) {
    if (snap.domains.length !== target.size) continue;
    let match = true;
    for (const d of snap.domains) {
      if (!target.has(d)) { match = false; break; }
    }
    if (!match) continue;
    if (!best || snap.savedAt > best.savedAt) best = snap;
  }
  return best;
}

// Sweep snapshots older than `maxAgeMs`. Returns count deleted.
export async function sweepOldSnapshots(maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const all = await listSnapshots();
  let deleted = 0;
  for (const snap of all) {
    if (snap.savedAt < cutoff) {
      await deleteSnapshot(snap.runId);
      deleted++;
    }
  }
  return deleted;
}

export function getSnapshotDir(): string {
  return SNAPSHOT_DIR;
}
