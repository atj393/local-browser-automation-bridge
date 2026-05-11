import { useState } from 'react';
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
    case 'needs_manual_post': return 'warn';
    default: return 'muted';
  }
};

const statusLabel = (status: PostStatus): string => {
  if (status === 'needs_manual_post') return 'Manual required';
  return status;
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
  onMarkPosted: (id: number) => void;
  busyId: number | null;
}

export function QueueTable({ items, onRetry, onSkip, onPostNow, onMarkPosted, busyId }: Props) {
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function copyContent(item: PostQueueItem) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.content);
      } else {
        const ta = document.createElement('textarea');
        ta.value = item.content;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1600);
    } catch {
      alert('Could not copy automatically. Select the content manually and press Ctrl+C.');
    }
  }

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
            <th>Category</th>
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
              <td style={{ fontSize: 12 }}>
                {it.categoryName ? (
                  <span className="badge muted">{it.categoryName}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }} title={it.sourceUrl ?? ''}>
                {it.sourceUrl ?? <span className="muted">—</span>}
              </td>
              <td><Badge variant={variantFor(it.status)}>{statusLabel(it.status)}</Badge></td>
              <td className="mono" style={{ fontSize: 12 }}>
                {it.status === 'pending'
                  ? formatScheduledTime(it.scheduledFor)
                  : it.status === 'posting'
                    ? 'Posting now'
                    : it.status === 'posted'
                      ? `Posted ${formatScheduledTime(it.postedAt)}`
                      : it.status === 'failed'
                        ? 'Failed'
                        : it.status === 'needs_manual_post'
                          ? 'Manual paste required'
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
              <td className="mono" style={{ color: 'var(--danger)', maxWidth: 280, whiteSpace: 'pre-wrap' }}>{it.errorMessage ?? ''}</td>
              <td>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <button
                    className="btn secondary"
                    onClick={() => copyContent(it)}
                    title="Copy this post's content to the clipboard"
                  >
                    {copiedId === it.id ? 'Copied!' : 'Copy'}
                  </button>
                  {(it.status === 'failed' ||
                    it.status === 'skipped' ||
                    it.status === 'needs_manual_post') && (
                    <button className="btn secondary" disabled={busyId === it.id} onClick={() => onRetry(it.id)}>Retry</button>
                  )}
                  {it.status === 'pending' && (
                    <button className="btn secondary" disabled={busyId === it.id} onClick={() => onSkip(it.id)}>Skip</button>
                  )}
                  {(it.status === 'needs_manual_post' ||
                    it.status === 'failed') && (
                    <button
                      className="btn"
                      disabled={busyId === it.id}
                      onClick={() => onMarkPosted(it.id)}
                      title="Mark this item as posted (after pasting it manually into X)"
                    >
                      Mark as posted
                    </button>
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
