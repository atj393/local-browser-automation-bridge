import type { AutomationSettings } from '../api/types.js';

const MODE_LABELS: Record<string, string> = {
  rotate: 'Rotate sources',
  first: 'Use first source only',
  none: 'Prompt only',
};

export function GenerationInfoPanel({ settings }: { settings: AutomationSettings | null }) {
  if (!settings) return null;
  const urlCount = settings.sourceUrls.length;
  return (
    <div className="panel">
      <h2 className="h2" style={{ marginTop: 0 }}>Generation</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div>
          <div className="label" style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>Posts per generation</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 600, marginTop: 4 }}>{settings.postsPerGeneration}</div>
        </div>
        <div>
          <div className="label" style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>Source mode</div>
          <div style={{ fontSize: '1rem', marginTop: 4 }}>{MODE_LABELS[settings.sourceMode] ?? settings.sourceMode}</div>
        </div>
        <div>
          <div className="label" style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>Sources configured</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 600, marginTop: 4 }}>{urlCount}</div>
        </div>
        <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <div className="label" style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>Last source used</div>
          <div className="mono" style={{ fontSize: 12, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {settings.lastSourceUrl ?? <span className="muted">— none yet —</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
