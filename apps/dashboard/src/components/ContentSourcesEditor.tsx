import { useEffect, useState } from 'react';
import type { Category, ContentSource } from '../api/types.js';
import { api } from '../api/client.js';

interface DraftSource {
  url: string;
  label: string;
  categoryId: number | null;
  isEnabled: boolean;
}

export function ContentSourcesEditor({
  categoriesVersion,
}: {
  /** Bumped by parent when categories change so the dropdown refreshes. */
  categoriesVersion?: number;
}) {
  const [items, setItems] = useState<ContentSource[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | 'create' | null>(null);
  const [draft, setDraft] = useState<DraftSource>({
    url: '',
    label: '',
    categoryId: null,
    isEnabled: true,
  });

  async function refresh() {
    try {
      const [s, c] = await Promise.all([api.listContentSources(), api.listCategories()]);
      setItems(s.items);
      setCategories(c.items);
      if (draft.categoryId == null && c.items.length > 0) {
        setDraft((d) => ({ ...d, categoryId: c.items[0]!.id }));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesVersion]);

  async function addSource() {
    if (!draft.url.trim() || draft.categoryId == null) return;
    setBusyId('create');
    setError(null);
    try {
      await api.createContentSource({
        url: draft.url.trim(),
        label: draft.label.trim() || null,
        categoryId: draft.categoryId,
        isEnabled: draft.isEnabled,
      });
      setDraft((d) => ({ ...d, url: '', label: '' }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function updateField(
    s: ContentSource,
    patch: Partial<{ url: string; label: string | null; categoryId: number; isEnabled: boolean }>,
  ) {
    setBusyId(s.id);
    setError(null);
    try {
      await api.updateContentSource(s.id, patch);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function removeSource(s: ContentSource) {
    if (!confirm(`Delete source "${s.url}"?`)) return;
    setBusyId(s.id);
    try {
      await api.deleteContentSource(s.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="field" style={{ background: '#f7f8fc', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <h2 className="h2" style={{ fontSize: '1rem', marginTop: 0, marginBottom: 6 }}>
        Content sources
      </h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        One row per source. Each source belongs to a category. Localhost / private-network URLs are rejected.
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>URL</th>
              <th>Label</th>
              <th>Category</th>
              <th>Enabled</th>
              <th style={{ width: 70 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                categories={categories}
                busy={busyId === s.id}
                onUpdate={(patch) => updateField(s, patch)}
                onDelete={() => removeSource(s)}
              />
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: '12px 0' }}>
                  No sources yet. Add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px' }}>
          <label>New source URL</label>
          <input
            type="text"
            placeholder="https://example.com/feed.xml"
            value={draft.url}
            onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          />
        </div>
        <div style={{ flex: '0 0 140px' }}>
          <label>Label (optional)</label>
          <input
            type="text"
            placeholder="Short name"
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </div>
        <div style={{ flex: '0 0 180px' }}>
          <label>Category</label>
          <select
            value={draft.categoryId ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, categoryId: Number(e.target.value) || null }))}
            style={{ padding: '8px 10px', width: '100%' }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="checkbox-row" style={{ marginBottom: 4 }}>
          <input
            id="new-source-enabled"
            type="checkbox"
            checked={draft.isEnabled}
            onChange={(e) => setDraft((d) => ({ ...d, isEnabled: e.target.checked }))}
          />
          <label htmlFor="new-source-enabled" style={{ marginBottom: 0 }}>Enabled</label>
        </div>
        <button
          className="btn"
          disabled={busyId === 'create' || !draft.url.trim() || draft.categoryId == null}
          onClick={addSource}
        >
          {busyId === 'create' ? 'Adding…' : 'Add source'}
        </button>
      </div>

      {error && <div className="mono" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function SourceRow({
  source,
  categories,
  busy,
  onUpdate,
  onDelete,
}: {
  source: ContentSource;
  categories: Category[];
  busy: boolean;
  onUpdate: (
    patch: Partial<{ url: string; label: string | null; categoryId: number; isEnabled: boolean }>,
  ) => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState(source.url);
  const [label, setLabel] = useState(source.label ?? '');
  useEffect(() => setUrl(source.url), [source.url]);
  useEffect(() => setLabel(source.label ?? ''), [source.label]);
  return (
    <tr>
      <td style={{ minWidth: 220, maxWidth: 320 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => {
            if (url.trim() && url.trim() !== source.url) onUpdate({ url: url.trim() });
          }}
          style={{ padding: '4px 8px', fontSize: 12 }}
          disabled={busy}
        />
      </td>
      <td>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => onUpdate({ label: label.trim() || null })}
          placeholder="—"
          style={{ padding: '4px 8px', fontSize: 12 }}
          disabled={busy}
        />
      </td>
      <td>
        <select
          value={source.categoryId}
          onChange={(e) => onUpdate({ categoryId: Number(e.target.value) })}
          style={{ padding: '4px 8px', fontSize: 12 }}
          disabled={busy}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="checkbox"
          checked={source.isEnabled}
          onChange={() => onUpdate({ isEnabled: !source.isEnabled })}
          disabled={busy}
        />
      </td>
      <td>
        <button
          className="btn secondary"
          style={{ fontSize: 12, padding: '4px 8px' }}
          disabled={busy}
          onClick={onDelete}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
