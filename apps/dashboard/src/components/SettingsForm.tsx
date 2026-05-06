import { useEffect, useState } from 'react';
import type { AutomationSettings, UpdateSettingsBody } from '../api/types.js';
import { DEFAULT_LLM_PROMPT } from '@lbab/shared';
import { PromptEditor } from './PromptEditor.js';
import { WarningBox } from './WarningBox.js';

interface Props {
  initial: AutomationSettings;
  onSave: (body: UpdateSettingsBody) => Promise<void>;
}

export function SettingsForm({ initial, onSave }: Props) {
  const [form, setForm] = useState<UpdateSettingsBody>({
    llmPrompt: initial.llmPrompt,
    batchSize: initial.batchSize,
    minIntervalSeconds: initial.minIntervalSeconds,
    maxIntervalSeconds: initial.maxIntervalSeconds,
    autoSubmitWriter: initial.autoSubmitWriter,
    writerUrlPattern: initial.writerUrlPattern,
    readerUrlPattern: initial.readerUrlPattern,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      llmPrompt: initial.llmPrompt,
      batchSize: initial.batchSize,
      minIntervalSeconds: initial.minIntervalSeconds,
      maxIntervalSeconds: initial.maxIntervalSeconds,
      autoSubmitWriter: initial.autoSubmitWriter,
      writerUrlPattern: initial.writerUrlPattern,
      readerUrlPattern: initial.readerUrlPattern,
    });
  }, [initial]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setForm((f) => ({ ...f, llmPrompt: DEFAULT_LLM_PROMPT }));
  }

  return (
    <div className="panel">
      <PromptEditor
        value={form.llmPrompt}
        onChange={(v) => setForm((f) => ({ ...f, llmPrompt: v }))}
      />

      <div className="field">
        <label>Batch size (1-50)</label>
        <input
          type="number"
          min={1}
          max={50}
          value={form.batchSize}
          onChange={(e) => setForm((f) => ({ ...f, batchSize: Number(e.target.value) }))}
        />
      </div>

      <div className="field" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label>Min interval seconds</label>
          <input
            type="number"
            min={10}
            value={form.minIntervalSeconds}
            onChange={(e) =>
              setForm((f) => ({ ...f, minIntervalSeconds: Number(e.target.value) }))
            }
          />
        </div>
        <div>
          <label>Max interval seconds</label>
          <input
            type="number"
            min={10}
            max={86400}
            value={form.maxIntervalSeconds}
            onChange={(e) =>
              setForm((f) => ({ ...f, maxIntervalSeconds: Number(e.target.value) }))
            }
          />
        </div>
      </div>

      <div className="field">
        <label>Writer URL pattern</label>
        <input
          type="text"
          value={form.writerUrlPattern}
          onChange={(e) => setForm((f) => ({ ...f, writerUrlPattern: e.target.value }))}
        />
      </div>
      <div className="field">
        <label>Reader URL pattern</label>
        <input
          type="text"
          value={form.readerUrlPattern}
          onChange={(e) => setForm((f) => ({ ...f, readerUrlPattern: e.target.value }))}
        />
      </div>

      <WarningBox>
        Auto-submit may post to X. Use only with test accounts and intentional demo content.
        Safe default is disabled.
      </WarningBox>
      {/x\.com|twitter\.com/i.test(form.writerUrlPattern) && form.autoSubmitWriter && (
        <WarningBox>
          <strong>Heads up:</strong> Writer URL pattern targets X/Twitter <em>and</em> auto-submit
          is enabled. Posts will be published publicly when the scheduler runs. Switch the writer
          URL to <code>http://localhost:4000/test/writer*</code> for safe demos, or disable
          auto-submit.
        </WarningBox>
      )}
      <div className="field checkbox-row">
        <input
          id="auto-submit"
          type="checkbox"
          checked={form.autoSubmitWriter}
          onChange={(e) => setForm((f) => ({ ...f, autoSubmitWriter: e.target.checked }))}
        />
        <label htmlFor="auto-submit" style={{ marginBottom: 0 }}>
          Auto-submit writer (click Post automatically when filling)
        </label>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={saving} onClick={submit}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <button className="btn secondary" disabled={saving} onClick={reset}>
          Reset prompt to default
        </button>
      </div>
      {savedAt && <div className="muted" style={{ marginTop: 8 }}>Saved at {savedAt}</div>}
      {error && <div className="mono" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
    </div>
  );
}
