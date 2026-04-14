export function deriveDomain(website) {
  if (!website) return '';
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return website.trim().toLowerCase().replace(/^www\./, '');
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export async function withRetry(fn, { tries = 3, baseMs = 1000, label = 'op' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = baseMs * Math.pow(2, i);
      console.warn(`[retry] ${label} attempt ${i + 1}/${tries} failed: ${err.message}. waiting ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
