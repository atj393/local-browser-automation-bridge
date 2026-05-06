export function nowIso(): string {
  return new Date().toISOString();
}

export function isoFromMsFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
