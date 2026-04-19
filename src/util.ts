export function normalizeLinkedInUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^http:/i, 'https:');
  return `https://${trimmed}`;
}

export function deriveDomain(website: string | undefined): string {
  if (!website) return '';
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return website.trim().toLowerCase().replace(/^www\./, '');
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number; label?: string } = {}
): Promise<T> {
  const { tries = 3, baseMs = 1000, label = 'op' } = opts;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const wait = baseMs * Math.pow(2, i);
      console.warn(`[retry] ${label} attempt ${i + 1}/${tries} failed: ${msg}. waiting ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
