/** Format seconds as "Due now" / "MM:SS" / "H:MM:SS". */
export function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds <= 0) return 'Due now';
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** Live countdown seconds derived from a scheduled-for ISO string. Returns null if not set. */
export function liveCountdownSeconds(scheduledFor: string | null | undefined): number | null {
  if (!scheduledFor) return null;
  const t = Date.parse(scheduledFor);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - Date.now()) / 1000));
}

/** Friendly absolute time string for the user's locale (e.g. "Today 14:32:10"). */
export function formatScheduledTime(iso: string | null | undefined): string {
  if (!iso) return 'Not scheduled';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not scheduled';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString();
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString()} ${time}`;
}

// formatIntervalRange + formatDurationHuman now live in ./time.ts so the
// settings UI and the dashboard share one source of truth.
export { formatIntervalRange, formatDurationHuman } from './time.js';
