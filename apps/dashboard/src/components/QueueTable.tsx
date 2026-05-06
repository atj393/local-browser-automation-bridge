import type { PostQueueItem, PostStatus } from '../api/types.js';
import { Badge } from './Badge.js';
import type { BadgeVariant } from './Badge.js';
import { formatCountdown, formatScheduledTime, liveCountdownSeconds } from '../utils/countdown.js';

const variantFor = (status: PostStatus): BadgeVariant => {
  switch (status) {
    case 'pending': return 'muted';
    case 'scheduled': return 'muted';
    case 'posting': return 'warn';
    case 'posted': return 'ok';
    case 'failed': return 'danger';
    case 'skipped': return 'muted';
    default: return 'muted';
  }
};

function formatTime(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

interface Props {
  items: PostQueueItem[];
  onRetry: (id: number) => void;
  onSkip: (id: number) => void;
  onPostNow: (id: number) => void;
  busyId: number | null;
}

export function QueueTable({ items, onRetry, onSkip, onPostNow, busyId }: Props) {
  if (!items.length) {
    return <div className="panel muted">Queue is empty.</div>;
  }
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>#</th>
            <th>Content</th>
            <th>Source</th>
            <th>Status</th>
            <th>Scheduled</th>
            <th>Countdown</th>
            <th>Created</th>
            <th>Posted</th>
            <th>Failed</th>
            <th>Error</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td className="mono">{it.id}</td>
              <td className="mono">
                {it.queuePosition ?? <span className="muted">—</span>}
              </td>
              <td style={{ maxWidth: 400 }}>{it.content}</td>
              <td className="mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }} title={it.sourceUrl ?? ''}>
                {it.sourceUrl ?? <span className="muted">—</span>}
              </td>
              <td><Badge variant={variantFor(it.status)}>{it.status}</Badge></td>
              <td className="mono" style={{ fontSize: 12 }}>
                {it.status === 'pending'
                  ? formatScheduledTime(it.scheduledFor)
                  : it.status === 'posting'
                    ? 'Posting now'
                    : it.status === 'posted'
                      ? `Posted ${formatScheduledTime(it.postedAt)}`
                      : it.status === 'failed'
                        ? 'Failed'
                        : '—'}
              </td>
              <td className="mono">
                {it.status === 'pending'
                  ? formatCountdown(liveCountdownSeconds(it.scheduledFor) ?? it.countdownSeconds ?? null)
                  : '—'}
              </td>
              <td className="mono">{formatTime(it.createdAt)}</td>
              <td className="mono">{formatTime(it.postedAt)}</td>
              <td className="mono">{formatTime(it.failedAt)}</td>
              <td className="mono" style={{ color: 'var(--danger)' }}>{it.errorMessage ?? ''}</td>
              <td>
                <div className="row">
                  {(it.status === 'failed' || it.status === 'skipped') && (
                    <button className="btn secondary" disabled={busyId === it.id} onClick={() => onRetry(it.id)}>Retry</button>
                  )}
                  {it.status === 'pending' && (
                    <button className="btn secondary" disabled={busyId === it.id} onClick={() => onSkip(it.id)}>Skip</button>
                  )}
                  {(it.status === 'pending' || it.status === 'failed' || it.status === 'skipped') && (
                    <button className="btn" disabled={busyId === it.id} onClick={() => onPostNow(it.id)}>Post now</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
