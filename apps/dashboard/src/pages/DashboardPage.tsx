import { useCallback, useEffect, useState } from 'react';
import type { StatusResponse } from '../api/types.js';
import { api } from '../api/client.js';
import { StatusCards } from '../components/StatusCards.js';
import { ControlPanel } from '../components/ControlPanel.js';
import { ConnectionChecklist } from '../components/ConnectionChecklist.js';

export function DashboardPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getStatus();
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <>
      <h1 className="h1">Dashboard</h1>
      {error && <div className="warning-box">Backend error: {error}</div>}
      <ConnectionChecklist status={status} />
      <ControlPanel status={status} onAfterAction={refresh} />
      <StatusCards status={status} />
      {status?.lastLog && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="label" style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>
            Last log
          </div>
          <div className="mono tight" style={{ marginTop: 6 }}>
            <strong>[{status.lastLog.level}]</strong> {status.lastLog.message}
            <span className="muted"> · {new Date(status.lastLog.createdAt).toLocaleTimeString()}</span>
          </div>
        </div>
      )}
    </>
  );
}
