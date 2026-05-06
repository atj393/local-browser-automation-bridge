import type { StatusResponse } from '../api/types.js';

type Row = { label: string; ok: boolean; ok_text: string; bad_text: string };

export function ConnectionChecklist({ status }: { status: StatusResponse | null }) {
  const rows: Row[] = status
    ? [
        { label: 'Backend', ok: true, ok_text: 'Online', bad_text: 'Offline' },
        {
          label: 'Extension',
          ok: status.extensionConnected,
          ok_text: 'Connected',
          bad_text: 'Not connected',
        },
        {
          label: 'Writer tab',
          ok: status.writerConnected,
          ok_text: 'Connected',
          bad_text: 'Not connected',
        },
        {
          label: 'Reader tab',
          ok: status.readerConnected,
          ok_text: 'Connected',
          bad_text: 'Not connected',
        },
        {
          label: 'Queue',
          ok: status.pendingCount > 0,
          ok_text: `${status.pendingCount} pending`,
          bad_text: 'Empty',
        },
        {
          label: 'Automation',
          ok: status.isRunning,
          ok_text: 'Running',
          bad_text: 'Stopped',
        },
      ]
    : [{ label: 'Backend', ok: false, ok_text: 'Online', bad_text: 'Offline' }];

  return (
    <div className="panel" style={{ padding: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <strong>Demo readiness checklist</strong>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          All four (Extension, Writer tab, Reader tab, Queue) should be green before posting.
        </div>
      </div>
      <table style={{ marginBottom: 0 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={{ width: 130 }}>{r.label}</td>
              <td>
                <span
                  className={`badge ${r.ok ? 'ok' : r.label === 'Automation' || r.label === 'Queue' ? 'muted' : 'danger'}`}
                >
                  {r.ok ? r.ok_text : r.bad_text}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
