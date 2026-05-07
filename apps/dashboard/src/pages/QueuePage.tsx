import { useCallback, useEffect, useState } from 'react';
import type { PostQueueItem, PostStatus } from '../api/types.js';
import { POST_STATUSES } from '@lbab/shared';
import { api } from '../api/client.js';
import { QueueTable } from '../components/QueueTable.js';

export function QueuePage() {
  const [items, setItems] = useState<PostQueueItem[]>([]);
  const [filter, setFilter] = useState<PostStatus | 'all'>('all');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.listPosts(filter === 'all' ? undefined : filter, 200);
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [filter]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  // Tick once a second so the countdown column updates smoothly.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  async function withBusy(id: number, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function clearQueue(status?: PostStatus) {
    if (!confirm(`Clear ${status ?? 'all'} items?`)) return;
    try {
      await api.clearQueue(status);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <h1 className="h1">Queue</h1>
      {error && <div className="warning-box">{error}</div>}
      <div className="panel">
        <div className="row" style={{ alignItems: 'center' }}>
          <label style={{ marginBottom: 0 }}>Filter</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as PostStatus | 'all')}
            style={{ padding: '6px 8px' }}
          >
            <option value="all">All</option>
            {POST_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className="btn secondary" onClick={refresh}>Refresh</button>
          <button className="btn danger" onClick={() => clearQueue()}>Clear all</button>
          <button className="btn secondary" onClick={() => clearQueue('failed')}>Clear failed</button>
          <button className="btn secondary" onClick={() => clearQueue('posted')}>Clear posted</button>
        </div>
      </div>
      <QueueTable
        items={items}
        busyId={busyId}
        onRetry={(id) => withBusy(id, () => api.retryPost(id))}
        onSkip={(id) => withBusy(id, () => api.skipPost(id))}
        onPostNow={(id) => withBusy(id, () => api.postNow(id))}
        onMarkPosted={(id) => withBusy(id, () => api.markPosted(id))}
      />
    </>
  );
}
