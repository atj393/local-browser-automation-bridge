export type IntervalUnit = 'seconds' | 'minutes' | 'hours';

export function intervalToSeconds(value: number, unit: IntervalUnit): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (unit === 'hours') return Math.round(value * 3600);
  if (unit === 'minutes') return Math.round(value * 60);
  return Math.round(value);
}

/**
 * Pick the most readable unit for a stored seconds value.
 * - divisible by 3600 → hours
 * - divisible by 60   → minutes
 * - otherwise         → seconds
 */
export function secondsToBestInterval(seconds: number): { value: number; unit: IntervalUnit } {
  if (!Number.isFinite(seconds) || seconds <= 0) return { value: 0, unit: 'seconds' };
  if (seconds % 3600 === 0) return { value: seconds / 3600, unit: 'hours' };
  if (seconds % 60 === 0) return { value: seconds / 60, unit: 'minutes' };
  return { value: seconds, unit: 'seconds' };
}

/**
 * Plain-English duration. Examples:
 *   10    → "10 seconds"
 *   60    → "1 minute"
 *   240   → "4 minutes"
 *   5000  → "1h 23m 20s"
 *   9000  → "2h 30m"
 *   19080 → "5h 18m"
 *   3600  → "1 hour"
 */
export function formatDurationHuman(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0 seconds';
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`;
  if (s < 3600 && s % 60 === 0) {
    const m = s / 60;
    return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  }
  if (s % 3600 === 0) {
    const h = s / 3600;
    return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rs = s % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (rs > 0) parts.push(`${rs}s`);
  return parts.join(' ');
}

/**
 * Friendly range label. Examples:
 *   60, 240   → "1–4 minutes"
 *   10, 20    → "10–20 seconds"
 *   3600,7200 → "1–2 hours"
 *   300, 900  → "5–15 minutes"
 *   5000,9000 → "1h 23m 20s – 2h 30m"
 */
export function formatIntervalRange(minSeconds: number, maxSeconds: number): string {
  const a = secondsToBestInterval(minSeconds);
  const b = secondsToBestInterval(maxSeconds);
  if (a.unit === b.unit) {
    if (a.value === b.value) {
      return `${a.value} ${a.unit}`;
    }
    return `${a.value}–${b.value} ${a.unit}`;
  }
  // Mixed / awkward — fall back to the human duration on each side.
  return `${formatDurationHuman(minSeconds)} – ${formatDurationHuman(maxSeconds)}`;
}

export interface IntervalPreset {
  id: 'testing' | 'demo' | 'normal' | 'slow';
  label: string;
  description: string;
  minSeconds: number;
  maxSeconds: number;
}

export const INTERVAL_PRESETS: IntervalPreset[] = [
  { id: 'testing', label: 'Testing', description: '10–20 seconds', minSeconds: 10, maxSeconds: 20 },
  { id: 'demo', label: 'Demo', description: '30–60 seconds', minSeconds: 30, maxSeconds: 60 },
  { id: 'normal', label: 'Normal', description: '1–4 minutes', minSeconds: 60, maxSeconds: 240 },
  { id: 'slow', label: 'Slow', description: '10–30 minutes', minSeconds: 600, maxSeconds: 1800 },
];

export interface BatchPreset {
  id: 'testing' | 'demo' | 'normal' | 'slow';
  label: string;
  description: string;
  minSeconds: number;
  maxSeconds: number;
}

export const BATCH_INTERVAL_PRESETS: BatchPreset[] = [
  { id: 'testing', label: 'Testing', description: '30–60 seconds', minSeconds: 30, maxSeconds: 60 },
  { id: 'demo', label: 'Demo', description: '2–5 minutes', minSeconds: 120, maxSeconds: 300 },
  { id: 'normal', label: 'Normal', description: '15–30 minutes', minSeconds: 900, maxSeconds: 1800 },
  { id: 'slow', label: 'Slow', description: '1–2 hours', minSeconds: 3600, maxSeconds: 7200 },
];

export function buildScheduleWarning(minSeconds: number, maxSeconds: number): string | null {
  if (maxSeconds < 60) {
    return 'Very short intervals are recommended only for local testing.';
  }
  if (maxSeconds > 3600) {
    return 'Your maximum interval is more than 1 hour. The next post may be scheduled much later.';
  }
  return null;
}
