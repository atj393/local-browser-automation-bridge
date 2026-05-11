import type {
  StatusResponse,
  ExtensionConnectionStatus,
  TabConnectionStatus,
} from '../api/types.js';
import { Badge } from './Badge.js';
import type { BadgeVariant } from './Badge.js';

function extensionBadge(s: ExtensionConnectionStatus): { variant: BadgeVariant; label: string } {
  if (!s.connected) return { variant: 'muted', label: 'Disconnected' };
  if (s.stale) return { variant: 'warn', label: 'Stale' };
  return { variant: 'ok', label: 'Connected' };
}

function tabBadge(s: TabConnectionStatus): { variant: BadgeVariant; label: string } {
  switch (s.readiness) {
    case 'ready':
      return { variant: 'ok', label: 'Ready' };
    case 'stale':
      return { variant: 'warn', label: 'Stale' };
    case 'url-found':
      return { variant: 'warn', label: 'Not responding' };
    case 'disconnected':
    default:
      return { variant: 'muted', label: 'Disconnected' };
  }
}

export function StatusCards({ status }: { status: StatusResponse | null }) {
  if (!status) {
    return <div className="panel">Loading status…</div>;
  }
  const ext = extensionBadge(status.extensionStatus);
  const reader = tabBadge(status.readerStatus);
  const writer = tabBadge(status.writerStatus);
  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="label">Automation</div>
          <div className="value">
            {status.isRunning ? <Badge variant="ok">Running</Badge> : <Badge variant="muted">Stopped</Badge>}
          </div>
        </div>
        <div className="card" title={status.extensionStatus.message}>
          <div className="label">Extension</div>
          <div className="value">
            <Badge variant={ext.variant}>{ext.label}</Badge>
          </div>
          {status.extensionStatus.message && !status.extensionStatus.connected && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {status.extensionStatus.message}
            </div>
          )}
        </div>
        <div className="card" title={status.writerStatus.message}>
          <div className="label">Writer tab</div>
          <div className="value">
            <Badge variant={writer.variant}>{writer.label}</Badge>
          </div>
          {status.writerStatus.readiness !== 'ready' && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {status.writerStatus.message}
            </div>
          )}
        </div>
        <div className="card" title={status.readerStatus.message}>
          <div className="label">Reader tab</div>
          <div className="value">
            <Badge variant={reader.variant}>{reader.label}</Badge>
          </div>
          {status.readerStatus.readiness !== 'ready' && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {status.readerStatus.message}
            </div>
          )}
        </div>
        <div className="card">
          <div className="label">Next run</div>
          <div className="value" style={{ fontSize: '1rem' }}>
            {status.nextRunAt ? new Date(status.nextRunAt).toLocaleTimeString() : <span className="muted">Not scheduled</span>}
          </div>
        </div>
      </div>
      <h2 className="h2">Queue</h2>
      <div className="cards">
        <CountCard label="Pending" value={status.pendingCount} />
        <CountCard label="Scheduled" value={status.scheduledCount} />
        <CountCard label="Posting" value={status.postingCount} />
        <CountCard label="Posted" value={status.postedCount} />
        <CountCard label="Failed" value={status.failedCount} />
        <CountCard label="Skipped" value={status.skippedCount} />
      </div>
    </>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
