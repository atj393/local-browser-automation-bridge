import { useState } from 'react';
import type { StatusResponse } from '../api/types.js';
import { api } from '../api/client.js';

interface Props {
  status: StatusResponse | null;
  onAfterAction: () => void;
}

export function ControlPanel({ status, onAfterAction }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setMessage(null);
    setError(null);
    try {
      const result = await fn();
      // Friendlier success summary for the two main demo actions.
      if (result && typeof result === 'object') {
        const r = result as { inserted?: number; sourceUrl?: string | null; resultStatus?: string };
        if (typeof r.inserted === 'number') {
          const src = r.sourceUrl ? ` · Source: ${r.sourceUrl}` : ' · Source: (none)';
          setMessage(`${label}: ok — generated ${r.inserted} post(s)${src}`);
        } else if (r.resultStatus) {
          setMessage(`${label}: ok — writer status: ${r.resultStatus}`);
        } else {
          setMessage(`${label}: ok ${JSON.stringify(result)}`);
        }
      } else {
        setMessage(`${label}: ok`);
      }
    } catch (err) {
      setError(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
      onAfterAction();
    }
  }

  const isRunning = status?.isRunning ?? false;
  const extOk = !!status?.extensionConnected;
  const writerOk = !!status?.writerConnected;
  const readerOk = !!status?.readerConnected;
  const hasPending = (status?.pendingCount ?? 0) > 0;
  const postingInFlight = (status?.postingCount ?? 0) > 0;

  // Reasons for disabled controls (rendered as title/tooltip).
  const generateReason = !extOk
    ? 'Extension not connected.'
    : !readerOk
      ? 'Reader tab not connected. Open Gemini or /test/llm and refresh.'
      : postingInFlight
        ? 'A post is currently being sent; please wait.'
        : '';
  const postReason = !extOk
    ? 'Extension not connected.'
    : !writerOk
      ? 'Writer tab not connected. Open X.com/home or /test/writer and refresh.'
      : postingInFlight
        ? 'A post is already in flight (status: posting). Please wait.'
        : !hasPending
          ? 'Queue is empty. Generate a batch first.'
          : '';
  const startReason = !extOk
    ? 'Extension not connected.'
    : !readerOk
      ? 'Reader tab not connected (needed to refill the queue).'
      : !writerOk
        ? 'Writer tab not connected (needed to post).'
        : postingInFlight
          ? 'A post is currently being sent; please wait.'
          : '';

  const generateDisabled = busy !== null || !!generateReason;
  const postDisabled = busy !== null || !!postReason;
  const startDisabled = busy !== null || isRunning || !!startReason;

  return (
    <div className="panel">
      <h2 className="h2" style={{ marginTop: 0 }}>Controls</h2>
      <div className="row">
        <button
          className="btn"
          disabled={startDisabled}
          title={startReason || (isRunning ? 'Already running.' : 'Start automation.')}
          onClick={() => run('Start automation', () => api.startAutomation())}
        >
          Start automation
        </button>
        <button
          className="btn secondary"
          disabled={busy !== null || !isRunning}
          onClick={() => run('Stop automation', () => api.stopAutomation())}
        >
          Stop automation
        </button>
        <button
          className="btn secondary"
          disabled={generateDisabled}
          title={generateReason || 'Send the prompt to Gemini and store its items.'}
          onClick={() => run('Generate next batch', () => api.generateBatch())}
        >
          Generate next batch now
        </button>
        <button
          className="btn secondary"
          disabled={postDisabled}
          title={postReason || 'Post the oldest pending item to the writer tab.'}
          onClick={() => run('Post next item', () => api.postNext())}
        >
          Post next item now
        </button>
        <button className="btn secondary" disabled={busy !== null} onClick={onAfterAction}>
          Refresh
        </button>
      </div>
      {(generateReason || postReason || startReason) && (
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {generateReason && <div>Generate disabled: {generateReason}</div>}
          {postReason && <div>Post disabled: {postReason}</div>}
          {startReason && !isRunning && <div>Start disabled: {startReason}</div>}
        </div>
      )}
      {message && (
        <div className="mono" style={{ marginTop: 12, color: 'var(--success)' }}>{message}</div>
      )}
      {error && (
        <div className="mono" style={{ marginTop: 12, color: 'var(--danger)' }}>{error}</div>
      )}
    </div>
  );
}
