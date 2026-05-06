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
} from './inputUtils.js';
import { sleep } from './waitUtils.js';

function isXHost(): boolean {
  const h = window.location.hostname.toLowerCase();
  return h === 'x.com' || h.endsWith('.x.com') || h === 'twitter.com' || h.endsWith('.twitter.com');
}

declare global {
  interface Window {
    __lbab_x_writer_loaded_v2__?: boolean;
    __local_browser_bridge_x_writer_loaded__?: boolean;
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
    console.log('[lbab/x-writer] message received', message?.type, location.href);

    if (message?.type === 'PING_CONTENT') {
      sendResponse({ ok: true, role: 'writer', url: location.href });
      return false;
    }

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

  try {
    chrome.runtime.sendMessage(
      { type: 'CONTENT_READY', role: 'writer', url: location.href },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            '[lbab/x-writer] CONTENT_READY failed',
            chrome.runtime.lastError.message,
          );
          return;
        }
        console.log('[lbab/x-writer] CONTENT_READY sent', response);
      },
    );
  } catch (err) {
    console.warn('[lbab/x-writer] CONTENT_READY threw', err);
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
  status?: 'filled' | 'submitted' | 'duplicate_ignored';
  autoSubmitted?: boolean;
  duplicate?: boolean;
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

    // Defense-in-depth: re-check the post button using the latest DOM.
    const xButton = findXPostButton();
    const buttonEnabled = isButtonEnabled(xButton);
    console.log('[lbab/x-writer] post button found:', !!xButton);
    console.log('[lbab/x-writer] post button enabled:', buttonEnabled);

    if (!draftResult.ok) {
      return {
        success: false,
        postId,
        operationId,
        error: draftResult.reason ?? 'X Draft.js insertion failed.',
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

    // Hard-fail when Draft.js never produced its real block/span shape, even
    // if the visible text matches — that is the "overlay" state.
    if (
      draftResult.diagnostics.dataTextSpanCount === 0 ||
      draftResult.diagnostics.blockCount === 0
    ) {
      return {
        success: false,
        postId,
        operationId,
        error:
          'X editor text appeared visually but no Draft.js block/span structure was produced. Click inside the X composer manually, then press Post next item now again.',
        url: window.location.href,
        ...({
          debug: {
            selector: selectorUsed,
            strategy: draftResult.strategy,
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
        return {
          success: false,
          postId,
          operationId,
          error:
            'X Draft.js state did not update; Post button is disabled. Click inside the X composer manually, then press Post next item now again.',
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

    // autoSubmit true on X — only click if button is actually enabled.
    if (!xButton) {
      return {
        success: false,
        postId,
        operationId,
        error: 'Could not find X post button.',
        url: window.location.href,
      };
    }
    if (!buttonEnabled) {
      return {
        success: false,
        postId,
        operationId,
        error: 'X Post button is still disabled after insertion; refusing to click.',
        url: window.location.href,
      };
    }
    console.log('[x-writer] clicking post button once', { operationId, postId });
    xButton.click();
    await sleep(450);
    console.log('[x-writer] submit completed', { operationId, postId });
    return {
      success: true,
      postId,
      operationId,
      status: 'submitted',
      autoSubmitted: true,
      url: window.location.href,
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
    url: window.location.href,
  };
}
