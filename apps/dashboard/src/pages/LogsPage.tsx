import { useCallback, useEffect, useState } from 'react';
import type { AutomationLog } from '../api/types.js';
import { api } from '../api/client.js';
import { LogsPanel } from '../components/LogsPanel.js';

export function LogsPage() {
  const [items, setItems] = useState<AutomationLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getLogs(200);
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function clearLogs() {
    if (!confirm('Clear all logs?')) return;
    await api.clearLogs();
    await refresh();
  }

  return (
    <>
      <h1 className="h1">Logs</h1>
      {error && <div className="warning-box">{error}</div>}
      <div className="panel">
        <div className="row">
          <button className="btn secondary" onClick={refresh}>Refresh</button>
          <button className="btn danger" onClick={clearLogs}>Clear logs</button>
        </div>
      </div>
      <LogsPanel items={items} />
    </>
  );
}
