import {
  GEMINI_INPUT_SELECTORS,
  GEMINI_INPUT_LOCAL_SELECTORS,
  GEMINI_SEND_SELECTORS,
  GEMINI_SEND_LOCAL_SELECTORS,
  GEMINI_SEND_TEXTS,
  GEMINI_RESPONSE_SELECTORS,
  GEMINI_RESPONSE_FALLBACK_SELECTORS,
  GEMINI_RESPONSE_LOCAL_SELECTORS,
  isLocalTestPage,
} from '../shared/selectors.js';
import { findVisibleElement, findButtonByText } from './domUtils.js';
import { insertTextIntoElement, readElementText } from './inputUtils.js';
import { sleep, waitForStableText } from './waitUtils.js';

declare global {
  interface Window {
    __local_browser_bridge_gemini_reader_loaded__?: boolean;
  }
}

if (!window.__local_browser_bridge_gemini_reader_loaded__) {
  window.__local_browser_bridge_gemini_reader_loaded__ = true;
  console.log('[lbab/gemini-reader] content script loaded', window.location.href);

  // 1) Register the listener BEFORE any async work so background
  //    can reach this content script as soon as it appears.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log('[lbab/gemini-reader] message received', message?.type, location.href);

    if (message?.type === 'PING_CONTENT') {
      sendResponse({ ok: true, role: 'reader', url: location.href });
      return false;
    }

    if (message?.type === 'GENERATE_NEXT_BATCH_CONTENT') {
      const { prompt } = message.payload as { prompt: string; batchSize: number };
      void handleGenerate(prompt)
        .then((result) => sendResponse(result))
        .catch((err) =>
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true;
    }

    return false;
  });
  console.log('[lbab/gemini-reader] message listener registered', location.href);

  // 2) Tell background we are ready. Use a callback so we surface failures.
  try {
    chrome.runtime.sendMessage(
      { type: 'CONTENT_READY', role: 'reader', url: location.href },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            '[lbab/gemini-reader] CONTENT_READY failed',
            chrome.runtime.lastError.message,
          );
          return;
        }
        console.log('[lbab/gemini-reader] CONTENT_READY sent', response);
      },
    );
  } catch (err) {
    console.warn('[lbab/gemini-reader] CONTENT_READY threw', err);
  }
}

async function handleGenerate(prompt: string): Promise<{
  success: boolean;
  rawText?: string;
  url?: string;
  error?: string;
}> {
  const local = isLocalTestPage();

  const inputSelectors = local
    ? [...GEMINI_INPUT_LOCAL_SELECTORS, ...GEMINI_INPUT_SELECTORS]
    : GEMINI_INPUT_SELECTORS;
  const sendSelectors = local
    ? [...GEMINI_SEND_LOCAL_SELECTORS, ...GEMINI_SEND_SELECTORS]
    : GEMINI_SEND_SELECTORS;
  const specificSelectors = local
    ? [...GEMINI_RESPONSE_LOCAL_SELECTORS, ...GEMINI_RESPONSE_SELECTORS]
    : GEMINI_RESPONSE_SELECTORS;
  const fallbackSelectors = local ? [] : GEMINI_RESPONSE_FALLBACK_SELECTORS;

  const input = await findVisibleElement(inputSelectors, 8000);
  if (!input) {
    return {
      success: false,
      error: 'Could not find Gemini input field.',
      url: window.location.href,
    };
  }

  // Capture initial response text so we can ignore it later.
  const initialResponseEl = await findVisibleElement(
    [...specificSelectors, ...fallbackSelectors],
    1000,
  );
  const initialResponseText = readElementText(initialResponseEl).trim();
  let fallbackUsed = false;

  input.focus();
  await sleep(80);
  const ok = await insertTextIntoElement(input, prompt);
  if (!ok) {
    return {
      success: false,
      error: 'Could not insert prompt into Gemini input.',
      url: window.location.href,
    };
  }
  await sleep(150);

  let sendBtn = await findVisibleElement(sendSelectors, 2000);
  if (!sendBtn) sendBtn = findButtonByText(GEMINI_SEND_TEXTS);
  if (!sendBtn) {
    return {
      success: false,
      error: 'Could not find Gemini send button.',
      url: window.location.href,
    };
  }

  (sendBtn as HTMLButtonElement).click();

  // Poll for response text.
  try {
    const result = await waitForStableText({
      ignoreInitial: initialResponseText,
      pollIntervalMs: 500,
      stableMs: 2000,
      timeoutMs: 120_000,
      getCandidate: () => {
        // Try specific selectors first (latest visible match per selector).
        for (const sel of specificSelectors) {
          const matches = Array.from(document.querySelectorAll<HTMLElement>(sel));
          for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i];
            if (!m) continue;
            const txt = readElementText(m).trim();
            if (txt.length) return txt;
          }
        }
        // Only fall back to broad selectors when nothing else matched.
        for (const sel of fallbackSelectors) {
          const matches = Array.from(document.querySelectorAll<HTMLElement>(sel));
          for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i];
            if (!m) continue;
            const txt = readElementText(m).trim();
            if (txt.length) {
              fallbackUsed = true;
              return txt;
            }
          }
        }
        return '';
      },
    });
    if (fallbackUsed) {
      console.warn(
        '[lbab/gemini-reader] Used fallback response selector (main/body); response may include unrelated text.',
      );
    }
    return { success: true, rawText: result, url: window.location.href };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      url: window.location.href,
    };
  }
}
