export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface WaitForStableTextOptions {
  getCandidate: () => string;
  pollIntervalMs?: number;
  stableMs?: number;
  timeoutMs?: number;
  ignoreInitial?: string;
}

/**
 * Polls getCandidate(); if the value differs from ignoreInitial, becomes
 * non-empty, and stops changing for `stableMs`, returns it. Otherwise rejects on timeout.
 */
export async function waitForStableText(opts: WaitForStableTextOptions): Promise<string> {
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const stableMs = opts.stableMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const start = Date.now();
  let lastCandidate = '';
  let lastChangeAt = Date.now();

  while (Date.now() - start < timeoutMs) {
    const current = opts.getCandidate();
    const isMeaningful =
      current.length > 0 && (!opts.ignoreInitial || current !== opts.ignoreInitial);
    if (current !== lastCandidate) {
      lastCandidate = current;
      lastChangeAt = Date.now();
    }
    if (isMeaningful && Date.now() - lastChangeAt >= stableMs) {
      return current;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error('Timed out waiting for stable response.');
}
