import { useEffect, useState } from 'react';
import type { Category } from '../api/types.js';
import { api } from '../api/client.js';

export function CategoryEditor({ onChange }: { onChange?: () => void }) {
  const [items, setItems] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#2563eb');
  const [busy, setBusy] = useState<number | 'create' | null>(null);

  async function refresh() {
    try {
      const r = await api.listCategories();
      setItems(r.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function addCategory() {
    if (!newName.trim()) return;
    setBusy('create');
    setError(null);
    try {
      await api.createCategory({ name: newName.trim(), color: newColor });
      setNewName('');
      await refresh();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(c: Category) {
    setBusy(c.id);
    try {
      await api.updateCategory(c.id, { isEnabled: !c.isEnabled });
      await refresh();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function rename(c: Category, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === c.name) return;
    setBusy(c.id);
    try {
      await api.updateCategory(c.id, { name: trimmed });
      await refresh();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(c: Category) {
    if (!confirm(`Delete category "${c.name}"? This is only possible when no sources use it.`))
      return;
    setBusy(c.id);
    try {
      const r = await api.deleteCategory(c.id);
      if (!r.ok) setError(r.error ?? 'Delete failed.');
      await refresh();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="field" style={{ background: '#f8f9ff', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <h2 className="h2" style={{ fontSize: '1rem', marginTop: 0, marginBottom: 6 }}>
        Categories
      </h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Group your sources. Every generated post inherits the category of the
        source it came from. The default <em>Rotate categories</em> queue mode
        avoids posting the same category twice in a row when multiple
        categories are pending.
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 24 }}>•</th>
              <th>Name</th>
              <th>Enabled</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                busy={busy === c.id}
                onRename={(name) => rename(c, name)}
                onToggle={() => toggleEnabled(c)}
                onDelete={() => remove(c)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label>New category name</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. AI Research"
          />
        </div>
        <div>
          <label>Color</label>
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            style={{ height: 36, padding: 0, border: '1px solid var(--border)', borderRadius: 6 }}
          />
        </div>
        <button
          className="btn"
          disabled={busy === 'create' || !newName.trim()}
          onClick={addCategory}
        >
          {busy === 'create' ? 'Adding…' : 'Add category'}
        </button>
      </div>
      {error && <div className="mono" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function CategoryRow({
  category,
  busy,
  onRename,
  onToggle,
  onDelete,
}: {
  category: Category;
  busy: boolean;
  onRename: (name: string) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(category.name);
  useEffect(() => setName(category.name), [category.name]);
  return (
    <tr>
      <td>
        <span
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: category.color ?? '#888',
          }}
        />
      </td>
      <td>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onRename(name)}
          style={{ padding: '4px 8px' }}
          disabled={busy}
        />
      </td>
      <td>
        <label className="checkbox-row" style={{ margin: 0 }}>
          <input type="checkbox" checked={category.isEnabled} onChange={onToggle} disabled={busy} />
          <span className="muted" style={{ fontSize: 12 }}>{category.isEnabled ? 'enabled' : 'disabled'}</span>
        </label>
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
