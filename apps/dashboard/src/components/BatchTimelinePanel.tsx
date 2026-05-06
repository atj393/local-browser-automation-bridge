import { useEffect, useState } from 'react';
import type { StatusResponse } from '../api/types.js';
import { formatCountdown, formatScheduledTime, liveCountdownSeconds } from '../utils/countdown.js';
import { Badge } from './Badge.js';

const REFILL_LABEL: Record<string, string> = {
  immediate: 'Immediate when queue is empty',
  random_delay: 'Random delay when queue is empty',
};

function batchBadge(s: StatusResponse | null) {
  if (!s) return <Badge variant="muted">Loading…</Badge>;
  const b = s.batchScheduler;
  if (b.isGeneratingBatch) return <Badge variant="warn">Generating</Badge>;
  if (!s.isRunning) return <Badge variant="muted">Stopped</Badge>;
  if (b.state === 'idle') return <Badge variant="ok">Idle (queue has items)</Badge>;
  if (b.state === 'waiting-for-batch') return <Badge variant="warn">Waiting</Badge>;
  if (b.state === 'paused') return <Badge variant="danger">Paused</Badge>;
  return <Badge variant="ok">{b.state}</Badge>;
}

export function BatchTimelinePanel({ status }: { status: StatusResponse | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!status) return <div className="panel">Loading batch timeline…</div>;
  const b = status.batchScheduler;
  const liveCountdown = liveCountdownSeconds(b.nextBatchRunAt);

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 className="h2" style={{ marginTop: 0 }}>Batch Generation Timeline</h2>
        <div>{batchBadge(status)}</div>
      </div>

      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        {b.message}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Stat
          label="Next batch in"
          value={
            b.isGeneratingBatch
              ? 'Now'
              : status.isRunning
                ? formatCountdown(liveCountdown ?? b.nextBatchCountdownSeconds)
                : '—'
          }
        />
        <Stat
          label="Scheduled"
          value={
            status.isRunning && b.nextBatchRunAt
              ? formatScheduledTime(b.nextBatchRunAt)
              : 'Not scheduled'
          }
        />
        <Stat label="Batch interval" value={b.batchIntervalRangeLabel} />
        <Stat label="Refill mode" value={REFILL_LABEL[b.refillMode] ?? b.refillMode} />
        <Stat
          label="Last batch generated"
          value={b.lastBatchGeneratedAt ? formatScheduledTime(b.lastBatchGeneratedAt) : '—'}
        />
        <Stat
          label="Reader (Gemini)"
          value={status.readerConnected ? 'Connected' : 'Not connected'}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label" style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}
