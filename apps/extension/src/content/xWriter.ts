import {
  X_COMPOSER_SELECTORS,
  X_COMPOSER_LOCAL_SELECTORS,
  X_POST_BUTTON_SELECTORS,
  X_POST_BUTTON_LOCAL_SELECTORS,
  X_POST_BUTTON_TEXTS,
  isLocalTestPage,
} from '../shared/selectors.js';
import { findVisibleElement, findButtonByText } from './domUtils.js';
import { insertTextIntoElement, readElementText } from './inputUtils.js';
import { sleep } from './waitUtils.js';

declare global {
  interface Window {
    __local_browser_bridge_x_writer_loaded__?: boolean;
  }
}

if (!window.__local_browser_bridge_x_writer_loaded__) {
  window.__local_browser_bridge_x_writer_loaded__ = true;
  console.log('[lbab/x-writer] content script loaded', window.location.href);

  // 1) Register the listener BEFORE any async work so background
  //    can reach this content script as soon as it appears.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log('[lbab/x-writer] message received', message?.type, location.href);

    if (message?.type === 'PING_CONTENT') {
      sendResponse({ ok: true, role: 'writer', url: location.href });
      return false;
    }

    if (message?.type === 'POST_TO_WRITER_CONTENT') {
      const { content, autoSubmit, postId } = message.payload as {
        content: string;
        autoSubmit: boolean;
        postId: number;
      };
      void handlePost(content, autoSubmit, postId)
        .then((result) => sendResponse(result))
        .catch((err) =>
          sendResponse({
            success: false,
            postId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true;
    }

    return false;
  });
  console.log('[lbab/x-writer] message listener registered', location.href);

  // 2) Tell background we are ready. Use a callback so we surface failures.
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
): Promise<{
  success: boolean;
  postId: number;
  status?: 'filled' | 'submitted';
  autoSubmitted?: boolean;
  url?: string;
  error?: string;
}> {
  const local = isLocalTestPage();
  const composerSelectors = local
    ? [...X_COMPOSER_LOCAL_SELECTORS, ...X_COMPOSER_SELECTORS]
    : X_COMPOSER_SELECTORS;

  const composer = await findVisibleElement(composerSelectors, 5000);
  if (!composer) {
    return {
      success: false,
      postId,
      error: 'Could not find X composer.',
      url: window.location.href,
    };
  }

  // Focus and clear-then-insert text.
  composer.focus();
  await sleep(80);
  const ok = await insertTextIntoElement(composer, content);
  if (!ok) {
    return {
      success: false,
      postId,
      error: 'Could not insert text into X composer.',
      url: window.location.href,
    };
  }

  // Confirm text appeared.
  await sleep(150);
  const observed = readElementText(composer).trim();
  if (!observed.length) {
    return {
      success: false,
      postId,
      error: 'Text did not appear in composer.',
      url: window.location.href,
    };
  }

  if (!autoSubmit) {
    return {
      success: true,
      postId,
      status: 'filled',
      autoSubmitted: false,
      url: window.location.href,
    };
  }

  // Auto-submit branch: find post button.
  const buttonSelectors = local
    ? [...X_POST_BUTTON_LOCAL_SELECTORS, ...X_POST_BUTTON_SELECTORS]
    : X_POST_BUTTON_SELECTORS;
  let button = await findVisibleElement(buttonSelectors, 2000);
  if (!button) button = findButtonByText(X_POST_BUTTON_TEXTS);
  if (!button) {
    return {
      success: false,
      postId,
      error: 'Could not find X post button.',
      url: window.location.href,
    };
  }

  (button as HTMLButtonElement).click();
  await sleep(200);

  return {
    success: true,
    postId,
    status: 'submitted',
    autoSubmitted: true,
    url: window.location.href,
  };
}
