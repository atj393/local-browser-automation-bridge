import type { AutomationLog } from '../api/types.js';
import { Badge } from './Badge.js';
import type { BadgeVariant } from './Badge.js';

const levelVariant = (level: string): BadgeVariant => {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'warn';
  if (level === 'info') return 'ok';
  return 'muted';
};

export function LogsPanel({ items }: { items: AutomationLog[] }) {
  if (!items.length) return <div className="panel muted">No logs yet.</div>;
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Level</th>
            <th>Message</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {items.map((log) => (
            <tr key={log.id}>
              <td className="mono">{new Date(log.createdAt).toLocaleTimeString()}</td>
              <td><Badge variant={levelVariant(log.level)}>{log.level}</Badge></td>
              <td>{log.message}</td>
              <td className="mono" style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {log.detailsJson ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
