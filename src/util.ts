export function normalizeLinkedInUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^http:/i, 'https:');
  return `https://${trimmed}`;
}

// Attio's `linkedin` attribute is a validated handle field, not free text — it rejects
// `www.`, `/showcase/` paths, and trailing slashes with `"LinkedIn handle is not valid"`.
// Bare slugs (e.g. `playstation-sony`) are accepted and Attio renders them as proper
// LinkedIn links. Returns '' if no slug can be extracted (caller should skip the write).
export function linkedInSlugForAttio(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (!/[/.]/.test(trimmed)) return trimmed;
  const match = trimmed.match(/linkedin\.com\/(?:company|showcase|in|school|pub)\/([^/?#]+)/i);
  return match?.[1] ?? '';
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
