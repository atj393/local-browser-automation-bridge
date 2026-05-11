import { useEffect, useState } from 'react';
import type {
  AutomationSettings,
  UpdateSettingsBody,
  SourceMode,
  BatchRefillMode,
} from '../api/types.js';
import {
  BATCH_REFILL_MODES,
  DEFAULT_LLM_PROMPT,
  POSTS_PER_GENERATION_MAX,
  POSTS_PER_GENERATION_MIN,
  SOURCE_MODES,
} from '@lbab/shared';
import { api } from '../api/client.js';
import { PromptEditor } from './PromptEditor.js';
import { WarningBox } from './WarningBox.js';
import { CategoryEditor } from './CategoryEditor.js';
import { ContentSourcesEditor } from './ContentSourcesEditor.js';
import {
  BATCH_INTERVAL_PRESETS,
  INTERVAL_PRESETS,
  buildScheduleWarning,
  formatDurationHuman,
  formatIntervalRange,
  intervalToSeconds,
  secondsToBestInterval,
  type IntervalUnit,
} from '../utils/time.js';

interface Props {
  initial: AutomationSettings;
  onSave: (body: UpdateSettingsBody) => Promise<void>;
}

interface FormState extends Omit<UpdateSettingsBody, 'sourceUrls'> {
  sourceUrlsRaw: string;
}

function fromSettings(s: AutomationSettings): FormState {
  return {
    llmPrompt: s.llmPrompt,
    postsPerGeneration: s.postsPerGeneration,
    minIntervalSeconds: s.minIntervalSeconds,
    maxIntervalSeconds: s.maxIntervalSeconds,
    autoSubmitWriter: s.autoSubmitWriter,
    writerUrlPattern: s.writerUrlPattern,
    readerUrlPattern: s.readerUrlPattern,
    sourceUrlsRaw: s.sourceUrls.join('\n'),
    sourceMode: s.sourceMode,
    batchMinIntervalSeconds: s.batchMinIntervalSeconds,
    batchMaxIntervalSeconds: s.batchMaxIntervalSeconds,
    batchRefillMode: s.batchRefillMode,
    queueSelectionMode: s.queueSelectionMode,
  };
}

const SOURCE_MODE_LABELS: Record<SourceMode, string> = {
  rotate: 'Rotate sources',
  first: 'Use first source only',
  none: 'No source / prompt only',
};

export function SettingsForm({ initial, onSave }: Props) {
  const [form, setForm] = useState<FormState>(() => fromSettings(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Force-refresh signal for the ContentSourcesEditor when categories change.
  const [categoriesVersion, setCategoriesVersion] = useState(0);

  // Test-source state.
  const [testUrl, setTestUrl] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof api.testSource>> | null>(
    null,
  );
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    setForm(fromSettings(initial));
  }, [initial]);

  async function submit() {
    setSaving(true);
    setError(null);
    const sourceUrls = form.sourceUrlsRaw
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    try {
      await onSave({
        llmPrompt: form.llmPrompt,
        postsPerGeneration: form.postsPerGeneration,
        minIntervalSeconds: form.minIntervalSeconds,
        maxIntervalSeconds: form.maxIntervalSeconds,
        autoSubmitWriter: form.autoSubmitWriter,
        writerUrlPattern: form.writerUrlPattern,
        readerUrlPattern: form.readerUrlPattern,
        sourceUrls,
        sourceMode: form.sourceMode,
        batchMinIntervalSeconds: form.batchMinIntervalSeconds,
        batchMaxIntervalSeconds: form.batchMaxIntervalSeconds,
        batchRefillMode: form.batchRefillMode,
        queueSelectionMode: form.queueSelectionMode,
      });
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

  const sourceUrlsList = form.sourceUrlsRaw
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  const xWarning =
    /x\.com|twitter\.com/i.test(form.writerUrlPattern) && form.autoSubmitWriter;

  return (
    <div className="panel">
      <h2 className="h2" style={{ marginTop: 0 }}>Prompt</h2>
      <PromptEditor
        value={form.llmPrompt}
        onChange={(v) => setForm((f) => ({ ...f, llmPrompt: v }))}
      />
      <div className="muted" style={{ fontSize: 12, marginTop: -6 }}>
        Supported placeholders:{' '}
        <code>{'{{postsPerGeneration}}'}</code>{' '}
        <code>{'{{sourceUrl}}'}</code>{' '}
        <code>{'{{sourceContext}}'}</code>{' '}
        <code>{'{{date}}'}</code>. If none are present, a context block is
        appended automatically.
      </div>

      <h2 className="h2">Generation</h2>
      <div className="field">
        <label>Posts per generation ({POSTS_PER_GENERATION_MIN}–{POSTS_PER_GENERATION_MAX})</label>
        <input
          type="number"
          min={POSTS_PER_GENERATION_MIN}
          max={POSTS_PER_GENERATION_MAX}
          value={form.postsPerGeneration}
          onChange={(e) =>
            setForm((f) => ({ ...f, postsPerGeneration: Number(e.target.value) }))
          }
        />
      </div>

      <IntervalControls
        minSeconds={form.minIntervalSeconds}
        maxSeconds={form.maxIntervalSeconds}
        onChange={(min, max) =>
          setForm((f) => ({ ...f, minIntervalSeconds: min, maxIntervalSeconds: max }))
        }
      />

      <BatchIntervalControls
        minSeconds={form.batchMinIntervalSeconds}
        maxSeconds={form.batchMaxIntervalSeconds}
        refillMode={form.batchRefillMode}
        onChange={(min, max, mode) =>
          setForm((f) => ({
            ...f,
            batchMinIntervalSeconds: min,
            batchMaxIntervalSeconds: max,
            batchRefillMode: mode,
          }))
        }
      />

      <h2 className="h2">Categories &amp; content sources</h2>
      <CategoryEditor onChange={() => setCategoriesVersion((v) => v + 1)} />
      <ContentSourcesEditor categoriesVersion={categoriesVersion} />
      <div className="field">
        <label>Source rotation mode</label>
        <select
          value={form.sourceMode}
          onChange={(e) => setForm((f) => ({ ...f, sourceMode: e.target.value as SourceMode }))}
          style={{ padding: '8px 10px', width: '100%' }}
        >
          {SOURCE_MODES.map((m) => (
            <option key={m} value={m}>{SOURCE_MODE_LABELS[m]}</option>
          ))}
        </select>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Controls which enabled content source is picked next when a batch is
          generated. Categories are independent: each generated post inherits
          the category of whichever source produced it.
        </div>
      </div>
      <div className="field">
        <label>Queue posting strategy</label>
        <select
          value={form.queueSelectionMode}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              queueSelectionMode: e.target.value as typeof f.queueSelectionMode,
            }))
          }
          style={{ padding: '8px 10px', width: '100%' }}
        >
          <option value="rotate_categories">Rotate categories (recommended)</option>
          <option value="oldest_first">Oldest first</option>
        </select>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {form.queueSelectionMode === 'rotate_categories'
            ? 'Avoids posting the same category twice in a row when multiple categories are pending.'
            : 'Posts queue items strictly in queue order, ignoring category.'}
        </div>
      </div>
      {initial.lastSourceUrl && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Last source used: <code>{initial.lastSourceUrl}</code>
          {initial.lastSourceId != null ? ` (id ${initial.lastSourceId})` : ''}
        </div>
      )}

      <div className="field" style={{ background: '#f7f8fc', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <label>Test source extraction</label>
            <input
              type="text"
              placeholder="https://example.com or https://example.com/feed.xml"
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              list="lbab-source-urls"
            />
            <datalist id="lbab-source-urls">
              {sourceUrlsList.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          <button
            className="btn secondary"
            disabled={testing || testUrl.trim().length === 0}
            onClick={async () => {
              setTesting(true);
              setTestError(null);
              setTestResult(null);
              try {
                const r = await api.testSource(testUrl.trim());
                setTestResult(r);
              } catch (err) {
                setTestError(err instanceof Error ? err.message : String(err));
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? 'Testing…' : 'Test source'}
          </button>
        </div>
        {testError && (
          <div className="mono" style={{ color: 'var(--danger)', marginTop: 8 }}>{testError}</div>
        )}
        {testResult && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <div>
              <strong>{testResult.ok ? 'OK' : 'No usable content'}</strong>
              {' · method: '}
              <code>{testResult.method ?? '—'}</code>
              {' · '}
              {testResult.extractedLength ?? 0} chars
              {testResult.status ? ` · HTTP ${testResult.status}` : ''}
              {testResult.size ? ` · ${Math.round((testResult.size ?? 0) / 1024)} KB` : ''}
            </div>
            {testResult.finalUrl && testResult.finalUrl !== testResult.url && (
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                Final URL: <code>{testResult.finalUrl}</code>
              </div>
            )}
            {testResult.title && (
              <div style={{ marginTop: 4 }}>
                <span className="muted">Title: </span>{testResult.title}
              </div>
            )}
            {testResult.preview && (
              <pre
                style={{
                  marginTop: 8,
                  background: '#0b1020',
                  color: '#d6e2ff',
                  padding: 10,
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 220,
                  overflow: 'auto',
                  fontSize: 11,
                }}
              >
                {testResult.preview}
              </pre>
            )}
            {!testResult.ok && testResult.error && (
              <div className="mono" style={{ color: 'var(--danger)', marginTop: 6 }}>
                {testResult.error}
              </div>
            )}
          </div>
        )}
      </div>

      <h2 className="h2">Targets</h2>
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
        Auto-submit may post to X publicly. Use only with test accounts and
        intentional demo content. Safe default is <strong>off</strong>; the
        recommended workflow is to fill the X composer and click Post
        manually.
      </WarningBox>
      {xWarning && (
        <WarningBox>
          <strong>Heads up:</strong> Writer URL pattern targets X/Twitter
          <em>and</em> auto-submit is enabled. Posts will be published when the
          scheduler runs. Switch the writer URL to{' '}
          <code>http://localhost:4000/test/writer*</code> for safe demos, or
          disable auto-submit.
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

interface IntervalControlsProps {
  minSeconds: number;
  maxSeconds: number;
  onChange: (minSeconds: number, maxSeconds: number) => void;
}

function IntervalControls({ minSeconds, maxSeconds, onChange }: IntervalControlsProps) {
  const minBest = secondsToBestInterval(minSeconds);
  const maxBest = secondsToBestInterval(maxSeconds);
  const [minValue, setMinValue] = useState<number>(minBest.value);
  const [minUnit, setMinUnit] = useState<IntervalUnit>(minBest.unit);
  const [maxValue, setMaxValue] = useState<number>(maxBest.value);
  const [maxUnit, setMaxUnit] = useState<IntervalUnit>(maxBest.unit);

  // Re-sync from parent when external settings change (e.g., after Save / Reset).
  useEffect(() => {
    const a = secondsToBestInterval(minSeconds);
    const b = secondsToBestInterval(maxSeconds);
    setMinValue(a.value);
    setMinUnit(a.unit);
    setMaxValue(b.value);
    setMaxUnit(b.unit);
  }, [minSeconds, maxSeconds]);

  function applyChange(
    nextMinValue: number,
    nextMinUnit: IntervalUnit,
    nextMaxValue: number,
    nextMaxUnit: IntervalUnit,
  ) {
    setMinValue(nextMinValue);
    setMinUnit(nextMinUnit);
    setMaxValue(nextMaxValue);
    setMaxUnit(nextMaxUnit);
    onChange(
      intervalToSeconds(nextMinValue, nextMinUnit),
      intervalToSeconds(nextMaxValue, nextMaxUnit),
    );
  }

  const warning = buildScheduleWarning(minSeconds, maxSeconds);
  const minTooLow = minSeconds < 10;
  const maxBelowMin = maxSeconds < minSeconds;
  const tooLong = maxSeconds > 86_400;
  const rangeLabel = formatIntervalRange(minSeconds, maxSeconds);

  return (
    <div className="field" style={{ background: '#f7f8fc', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <h2 className="h2" style={{ fontSize: '1rem', marginTop: 0, marginBottom: 4 }}>
        Posting interval
      </h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Each queued post is scheduled randomly between the minimum and maximum
        interval. Example: <em>1–4 minutes</em> means each next post is scheduled
        a random delay between 1 and 4 minutes after the previous one.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label>Minimum posting interval</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              min={1}
              value={minValue}
              onChange={(e) =>
                applyChange(Number(e.target.value), minUnit, maxValue, maxUnit)
              }
              style={{ flex: '1 1 auto' }}
            />
            <select
              value={minUnit}
              onChange={(e) =>
                applyChange(minValue, e.target.value as IntervalUnit, maxValue, maxUnit)
              }
              style={{ padding: '8px 10px' }}
            >
              <option value="seconds">seconds</option>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
            </select>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            = {formatDurationHuman(minSeconds)}
          </div>
        </div>
        <div>
          <label>Maximum posting interval</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              min={1}
              value={maxValue}
              onChange={(e) =>
                applyChange(minValue, minUnit, Number(e.target.value), maxUnit)
              }
              style={{ flex: '1 1 auto' }}
            />
            <select
              value={maxUnit}
              onChange={(e) =>
                applyChange(minValue, minUnit, maxValue, e.target.value as IntervalUnit)
              }
              style={{ padding: '8px 10px' }}
            >
              <option value="seconds">seconds</option>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
            </select>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            = {formatDurationHuman(maxSeconds)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 13 }}>
        <strong>Current range:</strong> {rangeLabel}
      </div>

      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {INTERVAL_PRESETS.map((p) => {
          const active = p.minSeconds === minSeconds && p.maxSeconds === maxSeconds;
          return (
            <button
              key={p.id}
              type="button"
              className={active ? 'btn' : 'btn secondary'}
              onClick={() => {
                const a = secondsToBestInterval(p.minSeconds);
                const b = secondsToBestInterval(p.maxSeconds);
                applyChange(a.value, a.unit, b.value, b.unit);
              }}
              style={{ fontSize: 12, padding: '6px 10px' }}
              title={p.description}
            >
              {p.label} · {p.description}
            </button>
          );
        })}
        <button
          type="button"
          className="btn secondary"
          onClick={() => applyChange(1, 'minutes', 4, 'minutes')}
          style={{ fontSize: 12, padding: '6px 10px' }}
        >
          Reset to default (1–4 minutes)
        </button>
      </div>

      {minTooLow && (
        <WarningBox>
          Minimum interval must be at least 10 seconds.
        </WarningBox>
      )}
      {maxBelowMin && (
        <WarningBox>
          Maximum interval must be greater than or equal to the minimum.
        </WarningBox>
      )}
      {tooLong && (
        <WarningBox>
          Maximum interval cannot exceed 24 hours.
        </WarningBox>
      )}
      {warning && !minTooLow && !maxBelowMin && !tooLong && (
        <WarningBox>{warning}</WarningBox>
      )}
    </div>
  );
}

interface BatchIntervalControlsProps {
  minSeconds: number;
  maxSeconds: number;
  refillMode: BatchRefillMode;
  onChange: (minSeconds: number, maxSeconds: number, mode: BatchRefillMode) => void;
}

function BatchIntervalControls({
  minSeconds,
  maxSeconds,
  refillMode,
  onChange,
}: BatchIntervalControlsProps) {
  const minBest = secondsToBestInterval(minSeconds);
  const maxBest = secondsToBestInterval(maxSeconds);
  const [minValue, setMinValue] = useState<number>(minBest.value);
  const [minUnit, setMinUnit] = useState<IntervalUnit>(minBest.unit);
  const [maxValue, setMaxValue] = useState<number>(maxBest.value);
  const [maxUnit, setMaxUnit] = useState<IntervalUnit>(maxBest.unit);

  useEffect(() => {
    const a = secondsToBestInterval(minSeconds);
    const b = secondsToBestInterval(maxSeconds);
    setMinValue(a.value);
    setMinUnit(a.unit);
    setMaxValue(b.value);
    setMaxUnit(b.unit);
  }, [minSeconds, maxSeconds]);

  function applyChange(
    nextMinValue: number,
    nextMinUnit: IntervalUnit,
    nextMaxValue: number,
    nextMaxUnit: IntervalUnit,
    nextMode: BatchRefillMode = refillMode,
  ) {
    setMinValue(nextMinValue);
    setMinUnit(nextMinUnit);
    setMaxValue(nextMaxValue);
    setMaxUnit(nextMaxUnit);
    onChange(
      intervalToSeconds(nextMinValue, nextMinUnit),
      intervalToSeconds(nextMaxValue, nextMaxUnit),
      nextMode,
    );
  }

  const minTooLow = minSeconds < 10;
  const maxBelowMin = maxSeconds < minSeconds;
  const tooLong = maxSeconds > 86_400;
  const rangeLabel = formatIntervalRange(minSeconds, maxSeconds);

  return (
    <div
      className="field"
      style={{
        background: '#f3f4ff',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
        marginTop: 12,
      }}
    >
      <h2 className="h2" style={{ fontSize: '1rem', marginTop: 0, marginBottom: 4 }}>
        Batch generation interval
      </h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Controls when Gemini is asked to create a new batch <em>after the queue
        becomes empty</em>. Post interval (above) controls the spacing between
        individual X posts.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label>Minimum batch interval</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              min={1}
              value={minValue}
              onChange={(e) =>
                applyChange(Number(e.target.value), minUnit, maxValue, maxUnit)
              }
              style={{ flex: '1 1 auto' }}
            />
            <select
              value={minUnit}
              onChange={(e) =>
                applyChange(minValue, e.target.value as IntervalUnit, maxValue, maxUnit)
              }
              style={{ padding: '8px 10px' }}
            >
              <option value="seconds">seconds</option>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
            </select>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            = {formatDurationHuman(minSeconds)}
          </div>
        </div>
        <div>
          <label>Maximum batch interval</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              min={1}
              value={maxValue}
              onChange={(e) =>
                applyChange(minValue, minUnit, Number(e.target.value), maxUnit)
              }
              style={{ flex: '1 1 auto' }}
            />
            <select
              value={maxUnit}
              onChange={(e) =>
                applyChange(minValue, minUnit, maxValue, e.target.value as IntervalUnit)
              }
              style={{ padding: '8px 10px' }}
            >
              <option value="seconds">seconds</option>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
            </select>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            = {formatDurationHuman(maxSeconds)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 13 }}>
        <strong>Current range:</strong> {rangeLabel}
      </div>

      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {BATCH_INTERVAL_PRESETS.map((p) => {
          const active = p.minSeconds === minSeconds && p.maxSeconds === maxSeconds;
          return (
            <button
              key={p.id}
              type="button"
              className={active ? 'btn' : 'btn secondary'}
              onClick={() => {
                const a = secondsToBestInterval(p.minSeconds);
                const b = secondsToBestInterval(p.maxSeconds);
                applyChange(a.value, a.unit, b.value, b.unit);
              }}
              style={{ fontSize: 12, padding: '6px 10px' }}
              title={p.description}
            >
              {p.label} · {p.description}
            </button>
          );
        })}
        <button
          type="button"
          className="btn secondary"
          onClick={() => applyChange(15, 'minutes', 30, 'minutes')}
          style={{ fontSize: 12, padding: '6px 10px' }}
        >
          Reset to default (15–30 minutes)
        </button>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Batch refill mode</label>
        <select
          value={refillMode}
          onChange={(e) =>
            applyChange(minValue, minUnit, maxValue, maxUnit, e.target.value as BatchRefillMode)
          }
          style={{ padding: '8px 10px', width: '100%' }}
        >
          <option value="random_delay">Wait a random delay when queue is empty</option>
          <option value="immediate">Generate immediately when queue is empty</option>
        </select>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {refillMode === 'random_delay'
            ? 'Default. After the last item is posted, the app waits a random delay (within the batch interval) before asking Gemini for a new batch.'
            : 'Aggressive. Calls Gemini as soon as the queue empties — useful for tight demos, not recommended for long-running automation.'}
        </div>
      </div>

      {minTooLow && <WarningBox>Minimum batch interval must be at least 10 seconds.</WarningBox>}
      {maxBelowMin && (
        <WarningBox>Maximum batch interval must be greater than or equal to the minimum.</WarningBox>
      )}
      {tooLong && <WarningBox>Maximum batch interval cannot exceed 24 hours.</WarningBox>}
      {/* Touch BATCH_REFILL_MODES to silence "imported but unused" if future code drops the enum reference. */}
      <span style={{ display: 'none' }}>{BATCH_REFILL_MODES.length}</span>
    </div>
  );
}
