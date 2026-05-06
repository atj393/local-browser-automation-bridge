import type { StatusResponse } from '../api/types.js';
import { Badge } from './Badge.js';

function statusBadge(connected: boolean, label: string) {
  return connected ? (
    <Badge variant="ok">{label}</Badge>
  ) : (
    <Badge variant="muted">Not {label.toLowerCase()}</Badge>
  );
}

export function StatusCards({ status }: { status: StatusResponse | null }) {
  if (!status) {
    return <div className="panel">Loading status…</div>;
  }
  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="label">Automation</div>
          <div className="value">
            {status.isRunning ? <Badge variant="ok">Running</Badge> : <Badge variant="muted">Stopped</Badge>}
          </div>
        </div>
        <div className="card">
          <div className="label">Extension</div>
          <div className="value">{statusBadge(status.extensionConnected, 'Connected')}</div>
        </div>
        <div className="card">
          <div className="label">Writer tab</div>
          <div className="value">{statusBadge(status.writerConnected, 'Connected')}</div>
        </div>
        <div className="card">
          <div className="label">Reader tab</div>
          <div className="value">{statusBadge(status.readerConnected, 'Connected')}</div>
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
