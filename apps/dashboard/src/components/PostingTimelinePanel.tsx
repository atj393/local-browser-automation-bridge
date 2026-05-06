import { useEffect, useState } from 'react';
import type { StatusResponse } from '../api/types.js';
import {
  formatCountdown,
  formatScheduledTime,
  liveCountdownSeconds,
} from '../utils/countdown.js';
import { formatIntervalRange, formatDurationHuman } from '../utils/time.js';
import { Badge } from './Badge.js';

function automationBadge(status: StatusResponse | null) {
  if (!status) return <Badge variant="muted">Loading…</Badge>;
  if (status.postingCount > 0) return <Badge variant="warn">Posting</Badge>;
  if (status.isRunning) return <Badge variant="ok">Running</Badge>;
  if (status.pendingCount > 0) return <Badge variant="warn">Paused</Badge>;
  return <Badge variant="muted">Stopped</Badge>;
}

export function PostingTimelinePanel({ status }: { status: StatusResponse | null }) {
  // Tick once a second so the countdowns update smoothly without re-fetching.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  void tick;

  if (!status) return <div className="panel">Loading timeline…</div>;

  // Prefer the server-rendered label (matches what the backend logs); fall
  // back to a client-side computation for forward compatibility.
  const interval =
    status.intervalRangeLabel ??
    formatIntervalRange(status.minIntervalSeconds, status.maxIntervalSeconds);
  const minLabel =
    status.minIntervalLabel ?? formatDurationHuman(status.minIntervalSeconds);
  const maxLabel =
    status.maxIntervalLabel ?? formatDurationHuman(status.maxIntervalSeconds);
  const liveCountdown = status.isRunning
    ? liveCountdownSeconds(status.nextPost?.scheduledFor ?? status.nextRunAt)
    : null;

  const writerWarn = status.isRunning && !status.writerConnected;
  const readerWarn = !status.readerConnected && status.pendingCount === 0;
  const pausedWarn = !status.isRunning && status.pendingCount > 0;

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 className="h2" style={{ marginTop: 0 }}>Posting Timeline</h2>
        <div>{automationBadge(status)}</div>
      </div>

      {writerWarn && (
        <div className="warning-box">
          Writer tab is disconnected. Posting cannot continue until the writer tab is ready.
        </div>
      )}
      {readerWarn && (
        <div className="warning-box">
          Reader tab is disconnected. <em>Generate batch</em> will not work until it is reconnected.
        </div>
      )}
      {pausedWarn && (
        <div className="warning-box">
          Schedule is paused. Click <strong>Start automation</strong> to refresh and continue.
        </div>
      )}
      {status.scheduleWarning && (
        <div className="warning-box">
          {status.scheduleWarning} Change it in <strong>Settings</strong> if this was accidental.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
        <Stat label="Next post in" value={status.isRunning ? formatCountdown(liveCountdown ?? status.nextPostCountdownSeconds) : '—'} />
        <Stat label="Scheduled" value={status.isRunning ? formatScheduledTime(status.nextPost?.scheduledFor ?? status.nextRunAt) : 'Not scheduled'} />
        <Stat label="Random interval" value={interval} />
        <Stat label="Minimum" value={minLabel} />
        <Stat label="Maximum" value={maxLabel} />
        <Stat
          label="Queue"
          value={`${status.pendingCount} waiting · ${status.postedCount} posted`}
        />
      </div>

      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        {status.automationMessage}
      </div>

      {status.nextPost ? (
        <div style={{ background: '#f7f8fc', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div className="label" style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>Next post</div>
          <div style={{ marginTop: 6, lineHeight: 1.4 }}>{status.nextPost.content}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            #{status.nextPost.id} · {status.nextPost.sourceUrl ?? 'no source'}
          </div>
        </div>
      ) : (
        <div className="muted">
          {status.pendingCount === 0
            ? 'Queue is empty. Generate a batch first.'
            : 'No upcoming post.'}
        </div>
      )}

      {status.queueTimeline.length > 1 && (
        <>
          <h2 className="h2" style={{ fontSize: '1rem', marginTop: 16 }}>Upcoming</h2>
          <div className="panel" style={{ padding: 0, marginBottom: 0, overflowX: 'auto' }}>
            <table style={{ marginBottom: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Content</th>
                  <th style={{ width: 130 }}>Scheduled</th>
                  <th style={{ width: 100 }}>Countdown</th>
                  <th style={{ width: 200 }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {status.queueTimeline.map((entry) => {
                  const live = status.isRunning
                    ? liveCountdownSeconds(entry.scheduledFor) ?? entry.countdownSeconds
                    : null;
                  return (
                    <tr key={entry.id}>
                      <td className="mono">{entry.position}</td>
                      <td style={{ maxWidth: 360 }}>{entry.content}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{formatScheduledTime(entry.scheduledFor)}</td>
                      <td className="mono">{status.isRunning ? formatCountdown(live) : '—'}</td>
                      <td className="mono" style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.sourceUrl ?? ''}>
                        {entry.sourceUrl ?? <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label" style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}
