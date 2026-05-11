import {
  X_COMPOSER_SELECTORS,
  X_COMPOSER_LOCAL_SELECTORS,
  X_POST_BUTTON_SELECTORS,
  X_POST_BUTTON_LOCAL_SELECTORS,
  X_POST_BUTTON_TEXTS,
  isLocalTestPage,
} from '../shared/selectors.js';
import { findVisibleElement, findButtonByText } from './domUtils.js';
import {
  ensureExactComposerText,
  insertIntoXDraftEditor,
  findXPostButton,
  isButtonEnabled,
  waitForXPostButtonEnabled,
  clickXPostButton,
  submitXWithCtrlEnter,
  waitForXSubmission,
} from './inputUtils.js';
import { sleep } from './waitUtils.js';

function isXHost(): boolean {
  const h = window.location.hostname.toLowerCase();
  return h === 'x.com' || h.endsWith('.x.com') || h === 'twitter.com' || h.endsWith('.twitter.com');
}

/* ------------------------------------------------------------------ */
/* Manual fallback: clipboard + on-page overlay                        */
/* ------------------------------------------------------------------ */

/**
 * Try a couple of routes to put `text` on the clipboard from a content
 * script. Both can fail (no clipboardWrite permission, no user gesture);
 * the function never throws and returns false in that case so the caller
 * can render an alternate "copy from dashboard" message.
 */
async function copyToClipboardInPage(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('[lbab/x-writer] navigator.clipboard.writeText failed', err);
  }

  // Fallback: temporary textarea + execCommand('copy'). Works without an
  // explicit clipboard permission when the page has user-gesture context.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  } catch (err) {
    console.warn('[lbab/x-writer] execCommand copy fallback failed', err);
    return false;
  }
}

const OVERLAY_ID = 'lbab-x-manual-overlay';

function removeXManualOverlay(): void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}

/**
 * Inject a small visible overlay on X explaining that automated input was
 * rejected and the user needs to paste manually. Idempotent — calling it
 * again replaces the existing overlay with a fresh one.
 */
function showXManualOverlay(content: string, clipboardCopied: boolean): void {
  removeXManualOverlay();
  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  Object.assign(root.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483647',
    width: '340px',
    maxWidth: 'calc(100vw - 40px)',
    background: '#11141d',
    color: '#f3f5fb',
    border: '1px solid #2c3242',
    borderRadius: '10px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    fontSize: '13px',
    lineHeight: '1.4',
    padding: '14px 14px 12px',
  });

  const title = document.createElement('div');
  title.textContent = 'Manual posting required';
  Object.assign(title.style, {
    fontSize: '14px',
    fontWeight: '700',
    marginBottom: '6px',
    color: '#ffd166',
  });
  root.appendChild(title);

  const body = document.createElement('div');
  body.textContent = clipboardCopied
    ? 'X did not accept automated input. The post content is copied to your clipboard.'
    : 'X did not accept automated input. Copy the content from the dashboard and paste it manually.';
  body.style.marginBottom = '8px';
  root.appendChild(body);

  const steps = document.createElement('ol');
  Object.assign(steps.style, { margin: '0 0 10px 18px', padding: '0' });
  ['Click inside the X composer.', 'Press Ctrl+V (or Cmd+V).', 'Review the post.', 'Click Post manually.'].forEach((s) => {
    const li = document.createElement('li');
    li.textContent = s;
    li.style.margin = '2px 0';
    steps.appendChild(li);
  });
  root.appendChild(steps);

  const buttonRow = document.createElement('div');
  Object.assign(buttonRow.style, { display: 'flex', gap: '8px', marginTop: '4px' });

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy content again';
  Object.assign(copyBtn.style, {
    flex: '1 1 auto',
    background: '#2348d6',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
  });
  copyBtn.addEventListener('click', async () => {
    const ok = await copyToClipboardInPage(content);
    copyBtn.textContent = ok ? 'Copied!' : 'Copy failed — copy from dashboard';
    setTimeout(() => {
      copyBtn.textContent = 'Copy content again';
    }, 1600);
  });
  buttonRow.appendChild(copyBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  Object.assign(dismissBtn.style, {
    background: 'transparent',
    color: '#d6d8e2',
    border: '1px solid #3a3f50',
    borderRadius: '6px',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: '12px',
  });
  dismissBtn.addEventListener('click', () => removeXManualOverlay());
  buttonRow.appendChild(dismissBtn);

  root.appendChild(buttonRow);

  document.body.appendChild(root);
}

declare global {
  interface Window {
    __lbab_x_writer_loaded_v2__?: boolean;
    __local_browser_bridge_x_writer_loaded__?: boolean;
    __lbab_writer_heartbeat_started__?: boolean;
    __lbab_writer_url_watcher_started__?: boolean;
  }
}

const WRITER_HEARTBEAT_MS = 30_000;
const WRITER_URL_WATCH_MS = 1500;

function sendWriterReady(opts: { heartbeat?: boolean; reason?: string } = {}): void {
  try {
    chrome.runtime.sendMessage(
      {
        type: 'CONTENT_READY',
        role: 'writer',
        url: location.href,
        heartbeat: !!opts.heartbeat,
        timestamp: Date.now(),
      },
      (response) => {
        if (chrome.runtime.lastError) {
          // Background worker may be asleep — expected, do not log spam.
          return;
        }
        if (opts.heartbeat) {
          console.log('[lbab/x-writer] heartbeat CONTENT_READY sent', response);
        } else {
          console.log(
            '[lbab/x-writer] CONTENT_READY sent',
            opts.reason ?? 'init',
            response,
          );
        }
      },
    );
  } catch (err) {
    console.warn('[lbab/x-writer] CONTENT_READY threw', err);
  }
}

// v2 guard — pre-existing v1 flag is also checked so that a stale page
// loaded under the older content script does not double-register.
const INIT_FLAG = '__lbab_x_writer_loaded_v2__';

if ((window as unknown as Record<string, boolean>)[INIT_FLAG]) {
  console.warn('[lbab/x-writer] duplicate content script load ignored');
} else if (window.__local_browser_bridge_x_writer_loaded__) {
  console.warn(
    '[lbab/x-writer] previous-version content script already loaded; not initializing v2',
  );
} else {
  (window as unknown as Record<string, boolean>)[INIT_FLAG] = true;
  window.__local_browser_bridge_x_writer_loaded__ = true;
  init();
}

function init(): void {
  console.log('[lbab/x-writer] content script loaded', window.location.href);

  // Per-tab idempotency. activeOperations covers the in-flight window;
  // completedOperations remembers ids we have already executed so a
  // redelivered POST_TO_WRITER_CONTENT cannot run the work twice.
  const activeOperations = new Set<string>();
  const completedOperations = new Set<string>();
  const COMPLETED_CAP = 200;

  function rememberCompleted(opId: string): void {
    completedOperations.add(opId);
    if (completedOperations.size > COMPLETED_CAP) {
      // Drop the oldest entry (insertion order is preserved).
      const first = completedOperations.values().next().value;
      if (first !== undefined) completedOperations.delete(first);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PING_CONTENT') {
      // Respond synchronously — service worker may have just woken up.
      sendResponse({ ok: true, role: 'writer', url: location.href });
      return false;
    }

    console.log('[lbab/x-writer] message received', message?.type, location.href);

    if (message?.type === 'POST_TO_WRITER_CONTENT') {
      const payload = (message.payload ?? {}) as {
        content?: string;
        autoSubmit?: boolean;
        postId?: number;
        operationId?: string;
      };
      const postId = Number(payload.postId);
      const content = String(payload.content ?? '');
      const autoSubmit = !!payload.autoSubmit;
      const operationId = String(payload.operationId ?? `post:${postId}:legacy`);

      console.log('[x-writer] operation received', { operationId, postId, autoSubmit });
      console.log('[lbab/x-writer] received autoSubmit:', autoSubmit);

      if (completedOperations.has(operationId)) {
        console.warn('[x-writer] duplicate operation ignored (completed)', operationId);
        sendResponse({
          success: true,
          postId,
          operationId,
          status: 'duplicate_ignored',
          autoSubmitted: false,
          duplicate: true,
          url: location.href,
        });
        return false;
      }

      if (activeOperations.has(operationId)) {
        console.warn('[x-writer] duplicate operation ignored (in-flight)', operationId);
        sendResponse({
          success: false,
          postId,
          operationId,
          error: 'Operation already in progress in writer tab',
        });
        return false;
      }

      activeOperations.add(operationId);
      void handlePost(content, autoSubmit, postId, operationId)
        .then((result) => {
          rememberCompleted(operationId);
          sendResponse(result);
        })
        .catch((err) => {
          // Failures still mark the op as completed: we will not retry the
          // exact same operationId on a redelivery (the backend creates a
          // fresh operationId for any user-initiated retry).
          rememberCompleted(operationId);
          sendResponse({
            success: false,
            postId,
            operationId,
            error: err instanceof Error ? err.message : String(err),
            url: location.href,
          });
        })
        .finally(() => {
          activeOperations.delete(operationId);
        });
      return true;
    }

    return false;
  });
  console.log('[lbab/x-writer] message listener registered', location.href);

  // Initial announce.
  sendWriterReady({ reason: 'init' });

  // Recover from idle / tab-switch quickly without waiting for the next
  // heartbeat tick.
  window.addEventListener('focus', () => sendWriterReady({ reason: 'focus' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sendWriterReady({ reason: 'visible' });
  });
  window.addEventListener('pageshow', () => sendWriterReady({ reason: 'pageshow' }));

  // Periodic heartbeat — runs while the tab is alive regardless of
  // service-worker sleep state.
  if (!window.__lbab_writer_heartbeat_started__) {
    window.__lbab_writer_heartbeat_started__ = true;
    setInterval(() => sendWriterReady({ heartbeat: true }), WRITER_HEARTBEAT_MS);
  }

  // X is an SPA; URL changes without a reload. Re-announce on nav.
  if (!window.__lbab_writer_url_watcher_started__) {
    window.__lbab_writer_url_watcher_started__ = true;
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[lbab/x-writer] navigation detected', lastUrl);
        sendWriterReady({ reason: 'navigation' });
      }
    }, WRITER_URL_WATCH_MS);
  }
}

async function handlePost(
  content: string,
  autoSubmit: boolean,
  postId: number,
  operationId: string,
): Promise<{
  success: boolean;
  postId: number;
  operationId: string;
  status?: 'filled' | 'submitted' | 'duplicate_ignored' | 'needs_manual_post';
  autoSubmitted?: boolean;
  submitMethod?: 'ctrl_enter' | 'meta_enter' | 'button_click' | 'none';
  duplicate?: boolean;
  manualActionRequired?: boolean;
  clipboardCopied?: boolean;
  url?: string;
  error?: string;
}> {
  const local = isLocalTestPage();
  const composerSelectors = local
    ? [...X_COMPOSER_LOCAL_SELECTORS, ...X_COMPOSER_SELECTORS]
    : X_COMPOSER_SELECTORS;

  // Find the most-specific contenteditable composer first.
  let composer: HTMLElement | null = null;
  let selectorUsed: string = '';
  for (const sel of composerSelectors) {
    const found = await findVisibleElement([sel], 0);
    if (found) {
      composer = found;
      selectorUsed = sel;
      break;
    }
  }
  if (!composer) {
    composer = await findVisibleElement(composerSelectors, 5000);
    if (composer) selectorUsed = '(timed-fallback)';
  }
  if (!composer) {
    return {
      success: false,
      postId,
      operationId,
      error: 'Could not find X composer.',
      url: window.location.href,
    };
  }
  console.log('[lbab/x-writer] composer selector used:', selectorUsed);
  console.log('[lbab/x-writer] autoSubmit:', autoSubmit);

  // Branch on host: X.com / Twitter.com use the Draft.js-aware path.
  // The local writer test page uses the existing native value setter path.
  const onX = isXHost();
  await sleep(80);

  if (onX) {
    const draftResult = await insertIntoXDraftEditor(composer, content);

    // First peek for the post button. autoSubmit:true uses
    // waitForXPostButtonEnabled() further down so X has time to validate
    // and enable the button.
    const xButton = findXPostButton();
    const buttonEnabled = isButtonEnabled(xButton);
    const buttonSelectorUsed = xButton?.getAttribute('data-testid') ?? '(text fallback)';
    console.log('[lbab/x-writer] post button selector used:', buttonSelectorUsed);
    console.log('[lbab/x-writer] post button found:', !!xButton);
    console.log('[lbab/x-writer] post button enabled:', buttonEnabled);

    // Reject-and-fall-back to manual-paste mode whenever automated
    // insertion did not produce real Draft.js state. We never keep
    // re-forcing input — that is exactly the behavior X protects against.
    const manualNeeded =
      !draftResult.ok ||
      draftResult.diagnostics.dataTextSpanCount === 0 ||
      draftResult.diagnostics.blockCount === 0 ||
      draftResult.strategy === 'manual-needed';

    if (manualNeeded) {
      console.warn('[lbab/x-writer] X automation rejected; entering manual-paste fallback', {
        strategy: draftResult.strategy,
        spans: draftResult.diagnostics.dataTextSpanCount,
        blocks: draftResult.diagnostics.blockCount,
      });
      const clipboardCopied = await copyToClipboardInPage(content);
      console.log(
        `[lbab/x-writer] clipboard copy ${clipboardCopied ? 'succeeded' : 'failed'}`,
      );
      try {
        showXManualOverlay(content, clipboardCopied);
      } catch (err) {
        console.warn('[lbab/x-writer] failed to show manual overlay', err);
      }
      console.log('[lbab/x-writer] manual posting required for postId', postId);
      return {
        success: false,
        postId,
        operationId,
        status: 'needs_manual_post',
        manualActionRequired: true,
        clipboardCopied,
        error: clipboardCopied
          ? 'X rejected automated input. Content copied to clipboard. Click the X composer and paste manually.'
          : 'X rejected automated input. Copy the content from the dashboard and paste it manually into the X composer.',
        url: window.location.href,
        ...({
          debug: {
            selector: selectorUsed,
            strategy: draftResult.strategy,
            attempts: draftResult.attempts,
            actualText: draftResult.text.slice(0, 240),
            diagnostics: draftResult.diagnostics,
          },
        } as Record<string, unknown>),
      };
    }

    console.log('[x-writer] composer filled (Draft.js)', {
      operationId,
      postId,
      strategy: draftResult.strategy,
      attempts: draftResult.attempts,
      length: draftResult.text.length,
      blocks: draftResult.diagnostics.blockCount,
      spans: draftResult.diagnostics.dataTextSpanCount,
    });

    if (!autoSubmit) {
      if (!buttonEnabled) {
        // Real-Draft.js shape exists but Post button never enabled — X
        // probably suppressed our insertion. Fall back to manual paste.
        const clipboardCopied = await copyToClipboardInPage(content);
        try {
          showXManualOverlay(content, clipboardCopied);
        } catch {
          /* ignore */
        }
        console.log('[lbab/x-writer] manual posting required for postId', postId);
        return {
          success: false,
          postId,
          operationId,
          status: 'needs_manual_post',
          manualActionRequired: true,
          clipboardCopied,
          error: clipboardCopied
            ? 'X rejected automated input. Content copied to clipboard. Click the X composer and paste manually.'
            : 'X rejected automated input. Copy the content from the dashboard and paste it manually into the X composer.',
          url: window.location.href,
          ...({
            debug: {
              selector: selectorUsed,
              strategy: draftResult.strategy,
              diagnostics: { ...draftResult.diagnostics, postButtonEnabled: false },
            },
          } as Record<string, unknown>),
        };
      }
      console.log('[x-writer] autoSubmit false; not clicking post', { operationId });
      return {
        success: true,
        postId,
        operationId,
        status: 'filled',
        autoSubmitted: false,
        submitMethod: 'none',
        url: window.location.href,
        ...({
          debug: {
            selector: selectorUsed,
            strategy: draftResult.strategy,
            postButtonEnabled: true,
          },
        } as Record<string, unknown>),
      };
    }

    // ------------------------------------------------------------------
    // autoSubmit:true on X — Ctrl+Enter primary, button click fallback.
    //
    // Manual Ctrl+Enter is X's documented submit shortcut and is the most
    // reliable way to commit a Draft.js post. The Inline Post button click
    // sometimes does not register through React's synthetic event system,
    // so we use it only as a fallback.
    //
    // Each strategy fires *exactly once* per operationId. If the first
    // succeeds (confirmed), we never run the second.
    // ------------------------------------------------------------------
    console.log('[lbab/x-writer] autoSubmit true');

    // Brief settle so X's validation finishes (button enable, length count).
    await sleep(500);

    let submitMethod: 'ctrl_enter' | 'button_click' | 'none' = 'none';
    let submitConfirmed = false;
    let submitElapsedMs = 0;
    let submitReason: string | undefined;

    // Strategy A — Ctrl+Enter (primary).
    try {
      await submitXWithCtrlEnter(composer, 'ctrl');
      const result = await waitForXSubmission(composer, content, 5000);
      if (result.ok) {
        submitMethod = 'ctrl_enter';
        submitConfirmed = true;
        submitElapsedMs = result.elapsedMs;
        submitReason = result.reason;
        console.log('[lbab/x-writer] Ctrl+Enter submitted: true');
        console.log(`[lbab/x-writer] submit confirmed after ${result.elapsedMs} ms`, {
          reason: result.reason,
        });
      } else {
        console.log('[lbab/x-writer] Ctrl+Enter submitted: false');
      }
    } catch (err) {
      console.warn('[lbab/x-writer] Ctrl+Enter dispatch threw', err);
    }

    // Strategy B — button click (fallback).
    if (!submitConfirmed) {
      console.log(
        '[lbab/x-writer] Ctrl+Enter did not confirm; trying button click fallback',
      );
      const enabledBtn = await waitForXPostButtonEnabled(3000);
      if (!enabledBtn) {
        return {
          success: false,
          postId,
          operationId,
          error:
            'Auto-submit failed: Ctrl+Enter did not confirm and the X Post button is still disabled. Try the post manually.',
          url: window.location.href,
          ...({
            debug: {
              selector: selectorUsed,
              postButtonSelector: buttonSelectorUsed,
              postButtonFound: !!xButton,
              postButtonEnabled: buttonEnabled,
              attempted: ['ctrl_enter'],
            },
          } as Record<string, unknown>),
        };
      }
      console.log('[lbab/x-writer] attempting button click submit');
      try {
        await clickXPostButton(enabledBtn);
      } catch (err) {
        return {
          success: false,
          postId,
          operationId,
          error: `Click dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
          url: window.location.href,
        };
      }
      const result = await waitForXSubmission(composer, content, 2000);
      if (result.ok) {
        submitMethod = 'button_click';
        submitConfirmed = true;
        submitElapsedMs = result.elapsedMs;
        submitReason = result.reason;
        console.log('[lbab/x-writer] button click submitted: true');
        console.log(`[lbab/x-writer] submit confirmed after ${result.elapsedMs} ms`, {
          reason: result.reason,
        });
      } else {
        console.log('[lbab/x-writer] button click submitted: false');
      }
    }

    if (!submitConfirmed) {
      return {
        success: false,
        postId,
        operationId,
        error:
          'Auto-submit dispatched (Ctrl+Enter then button click) but submission could not be confirmed within 5 seconds.',
        url: window.location.href,
        ...({
          debug: {
            selector: selectorUsed,
            attempted: ['ctrl_enter', 'button_click'],
            elapsedMs: submitElapsedMs,
          },
        } as Record<string, unknown>),
      };
    }

    console.log('[x-writer] submit status returned: submitted');
    return {
      success: true,
      postId,
      operationId,
      status: 'submitted',
      autoSubmitted: true,
      submitMethod,
      url: window.location.href,
      ...({
        debug: {
          selector: selectorUsed,
          submitMethod,
          submitConfirmedReason: submitReason,
          submitElapsedMs,
          clicked: submitMethod === 'button_click',
        },
      } as Record<string, unknown>),
    };
  }

  // ---- Local-test-writer path (textarea / native value setter) ----------
  const ensured = ensureExactComposerText(composer, content);
  if (!ensured.ok) {
    const errMsg = ensured.duplicated
      ? ensured.error ??
        'Composer contains duplicated content after insertion; refusing to continue.'
      : (ensured.error ?? 'Composer text does not match target after insertion.');
    return {
      success: false,
      postId,
      operationId,
      error: errMsg,
      url: window.location.href,
      ...({
        debug: {
          selector: selectorUsed,
          strategyUsed: ensured.strategyUsed,
          expectedLength: ensured.expectedLength,
          actualLength: ensured.actualLength,
          expectedPreview: ensured.expectedPreview,
          actualPreview: ensured.actualPreview,
          duplicated: ensured.duplicated,
        },
      } as Record<string, unknown>),
    };
  }
  console.log('[x-writer] composer filled (local)', {
    operationId,
    postId,
    strategy: ensured.strategyUsed,
    length: ensured.actualLength,
  });

  if (!autoSubmit) {
    console.log('[x-writer] autoSubmit false; not clicking post', { operationId });
    return {
      success: true,
      postId,
      operationId,
      status: 'filled',
      autoSubmitted: false,
      submitMethod: 'none',
      url: window.location.href,
    };
  }

  // Auto-submit branch (local test page only) — single controlled click.
  const buttonSelectors = [...X_POST_BUTTON_LOCAL_SELECTORS, ...X_POST_BUTTON_SELECTORS];
  let button = await findVisibleElement(buttonSelectors, 2000);
  if (!button) button = findButtonByText(X_POST_BUTTON_TEXTS);
  if (!button) {
    return {
      success: false,
      postId,
      operationId,
      error: 'Could not find writer post button.',
      url: window.location.href,
    };
  }
  console.log('[x-writer] clicking post button once', { operationId, postId });
  (button as HTMLButtonElement).click();
  button = null;
  await sleep(400);
  console.log('[x-writer] submit completed', { operationId, postId });

  return {
    success: true,
    postId,
    operationId,
    status: 'submitted',
    autoSubmitted: true,
    submitMethod: 'button_click',
    url: window.location.href,
  };
}
