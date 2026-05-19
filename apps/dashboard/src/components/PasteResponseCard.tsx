import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { Category } from '../api/types.js';

interface IngestResult {
  inserted: number;
  batchId: string;
  trimmedCount: number;
  droppedCount: number;
}

/**
 * Recovery panel: paste a raw Gemini response that the extension
 * failed to auto-capture and feed it into the same parsing +
 * cleaning pipeline used by the auto-generated batch flow.
 *
 * - Source rotation is NOT consumed (manual paste is a recovery action).
 * - The user picks the target category (or leaves it blank for
 *   "Manual paste") so category rotation stays predictable.
 */
export function PasteResponseCard() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [rawText, setRawText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.listCategories();
        if (!cancelled) setCategories(r.items);
      } catch {
        // The dropdown stays empty; the user can still submit without
        // a category (it falls back to "Manual paste" server-side).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (!rawText.trim()) {
      setError('Paste a Gemini response first.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      const r = await api.ingestRawBatch({ rawText, categoryId });
      setResult({
        inserted: r.inserted,
        batchId: r.batchId,
        trimmedCount: r.trimmedCount,
        droppedCount: r.droppedCount,
      });
      setRawText('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // The backend returns a JSON body with `preview` on parse failure;
      // the request wrapper throws with the `error` message only, so we
      // can't surface the preview here without additional plumbing. Keep
      // the textarea content intact so the user can edit and retry.
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  function clearFeedback() {
    setError(null);
    setResult(null);
    setPreview(null);
  }

  return (
    <div className="panel">
      <h2 className="h2" style={{ marginTop: 0 }}>
        Paste Gemini response
      </h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Use this when a batch failed to auto-capture (e.g. Gemini's <em>thinking</em>{' '}
        mode took longer than the configured response wait, or the selectors
        missed the answer). Paste the raw response — JSON, JSON inside a code
        fence, or text containing a JSON block — and pick a category. The same
        cleaning and dedupe rules used by the automated path apply.
      </div>

      <div className="row" style={{ gap: 12, marginBottom: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 220px' }}>
          <label>Category</label>
          <select
            value={categoryId ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setCategoryId(v === '' ? null : Number(v));
            }}
            style={{ padding: '8px 10px', width: '100%' }}
            disabled={busy}
          >
            <option value="">Manual paste (no category)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Raw Gemini response</label>
        <textarea
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            clearFeedback();
          }}
          placeholder='{ "items": [ { "content": "..." }, ... ] }'
          rows={10}
          style={{
            width: '100%',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
          }}
          disabled={busy}
        />
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy || !rawText.trim()} onClick={submit}>
          {busy ? 'Ingesting…' : 'Ingest into queue'}
        </button>
        <button
          className="btn secondary"
          disabled={busy || !rawText}
          onClick={() => {
            setRawText('');
            clearFeedback();
          }}
        >
          Clear
        </button>
      </div>

      {result && (
        <div
          className="mono"
          style={{
            color: 'var(--ok, #16a34a)',
            marginTop: 10,
            fontSize: 13,
          }}
        >
          ✓ {result.inserted} item{result.inserted === 1 ? '' : 's'} added to
          batch <strong>{result.batchId}</strong>
          {result.droppedCount > 0 && ` · ${result.droppedCount} dropped`}
          {result.trimmedCount > 0 && ` · ${result.trimmedCount} trimmed`}
        </div>
      )}
      {error && (
        <div className="mono" style={{ color: 'var(--danger)', marginTop: 10, fontSize: 13 }}>
          {error}
        </div>
      )}
      {preview && (
        <pre
          className="mono"
          style={{
            color: 'var(--muted)',
            marginTop: 6,
            fontSize: 11,
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          {preview}
        </pre>
      )}
    </div>
  );
}
