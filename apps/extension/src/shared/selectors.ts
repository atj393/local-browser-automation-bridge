// X uses Draft.js. Target the actual editable div, never a wrapper. Order
// matters — most specific first.
export const X_COMPOSER_SELECTORS = [
  'div.public-DraftEditor-content[contenteditable="true"][data-testid="tweetTextarea_0"]',
  'div[contenteditable="true"][data-testid="tweetTextarea_0"][role="textbox"][aria-label="Post text"]',
  'div[contenteditable="true"][data-testid="tweetTextarea_0"]',
  'div.public-DraftEditor-content[contenteditable="true"][role="textbox"]',
  'div[role="textbox"][contenteditable="true"][aria-label="Post text"]',
  'div[role="textbox"][contenteditable="true"]',
  'div[contenteditable="true"]',
  'textarea',
];

export const X_COMPOSER_LOCAL_SELECTORS = ['#x-compose', 'textarea#x-compose'];

export const X_POST_BUTTON_SELECTORS = [
  'button[data-testid="tweetButtonInline"]',
  'button[data-testid="tweetButton"]',
];

export const X_POST_BUTTON_LOCAL_SELECTORS = ['#x-post-button'];

export const X_POST_BUTTON_TEXTS = ['Post', 'Tweet'];

export const GEMINI_INPUT_SELECTORS = [
  'div[contenteditable="true"][role="textbox"]',
  'div.ql-editor[contenteditable="true"]',
  'rich-textarea div[contenteditable="true"]',
  'textarea',
  '[role="textbox"]',
];

export const GEMINI_INPUT_LOCAL_SELECTORS = ['#gemini-input'];

export const GEMINI_SEND_SELECTORS = [
  'button[aria-label*="Send"]',
  'button[aria-label*="Submit"]',
  'button[type="submit"]',
];

export const GEMINI_SEND_LOCAL_SELECTORS = ['#gemini-send'];

export const GEMINI_SEND_TEXTS = ['Send'];

// Specific selectors are tried first. Fallback selectors are tried only when
// no specific selector yielded any text.
export const GEMINI_RESPONSE_SELECTORS = [
  '.model-response-text',
  'message-content',
  '[data-message-author-role="model"]',
  '[data-message-author-role="assistant"]',
];

export const GEMINI_RESPONSE_FALLBACK_SELECTORS = ['main', 'body'];

export const GEMINI_RESPONSE_LOCAL_SELECTORS = ['#gemini-response'];

export function isLocalTestPage(): boolean {
  try {
    const u = new URL(window.location.href);
    return u.hostname === 'localhost' && u.port === '4000';
  } catch {
    return false;
  }
}
