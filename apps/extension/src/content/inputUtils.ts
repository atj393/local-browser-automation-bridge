// Reliable input insertion utilities for textarea/input and contenteditable elements.

export function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(element);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  const setter = desc?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Selection helpers
 */
function selectElementContents(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function getVisibleText(el: HTMLElement): string {
  // innerText respects rendered line breaks; textContent is a cheaper fallback.
  const txt = el.innerText ?? el.textContent ?? '';
  return txt;
}

export function normalizeComposerText(text: string): string {
  return text
    .replace(/ /g, ' ') // nbsp → space
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function dispatchPlainInput(el: HTMLElement): void {
  // Plain input event WITHOUT `data` so framework editors (React / Lexical /
  // Draft) don't interpret it as a *new* insertion to apply on top of what we
  // already inserted. This is the single most important rule of this file.
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Strategy A — execCommand-based clear + insert.
 * Returns true if the composer's visible text exactly matches `target` afterwards.
 */
function strategyAExecCommand(composer: HTMLElement, target: string): boolean {
  composer.focus();
  if (!selectElementContents(composer)) return false;
  // Clear: delete the selection.
  try {
    document.execCommand('delete', false);
  } catch {
    return false;
  }
  // Insert: this fires beforeinput + input with inputType:'insertText',
  // which framework editors handle correctly *once*.
  let okInsert = false;
  try {
    okInsert = document.execCommand('insertText', false, target);
  } catch {
    okInsert = false;
  }
  if (!okInsert) return false;
  dispatchPlainInput(composer);
  return normalizeComposerText(getVisibleText(composer)) === normalizeComposerText(target);
}

/**
 * Strategy B — Range deleteContents + textContent assignment.
 * Used when execCommand is unavailable or didn't produce an exact match.
 */
function strategyBRangeReplace(composer: HTMLElement, target: string): boolean {
  composer.focus();
  const sel = window.getSelection();
  if (!sel) return false;
  try {
    const range = document.createRange();
    range.selectNodeContents(composer);
    sel.removeAllRanges();
    sel.addRange(range);
    range.deleteContents();
  } catch {
    return false;
  }
  try {
    composer.textContent = target;
  } catch {
    return false;
  }
  dispatchPlainInput(composer);
  return normalizeComposerText(getVisibleText(composer)) === normalizeComposerText(target);
}

/**
 * Strategy C — native value setter for <textarea> / <input>.
 */
function strategyCNativeValue(
  element: HTMLTextAreaElement | HTMLInputElement,
  target: string,
): boolean {
  setNativeValue(element, target);
  return normalizeComposerText(element.value) === normalizeComposerText(target);
}

export interface EnsureExactResult {
  ok: boolean;
  strategyUsed: 'A_execCommand' | 'B_rangeReplace' | 'C_nativeValue' | 'none';
  expectedLength: number;
  actualLength: number;
  expectedPreview: string;
  actualPreview: string;
  duplicated: boolean;
  error?: string;
}

function preview(s: string): string {
  return s.length <= 120 ? s : s.slice(0, 120) + '…';
}

/**
 * Authoritative composer insertion.
 *
 * Guarantees that on success, the composer's visible text exactly equals
 * `targetText` (after light normalization: nbsp → space, CRLF → LF, trim).
 *
 * Tries strategies one at a time. **Returns immediately after the first
 * strategy that produces an exact match.** Never silently accepts duplicated
 * or appended content.
 */
export function ensureExactComposerText(
  composer: HTMLElement,
  targetTextRaw: string,
): EnsureExactResult {
  const target = normalizeComposerText(targetTextRaw);
  const baseDebug = {
    expectedLength: target.length,
    expectedPreview: preview(target),
  };

  const isFormField =
    composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement;

  console.log('[lbab/x-writer] target content length:', target.length);

  // Try strategies in order.
  const strategies: Array<{ name: EnsureExactResult['strategyUsed']; run: () => boolean }> = [];
  if (isFormField) {
    strategies.push({
      name: 'C_nativeValue',
      run: () =>
        strategyCNativeValue(composer as HTMLTextAreaElement | HTMLInputElement, target),
    });
  } else {
    strategies.push({ name: 'A_execCommand', run: () => strategyAExecCommand(composer, target) });
    strategies.push({ name: 'B_rangeReplace', run: () => strategyBRangeReplace(composer, target) });
  }

  let lastActual = '';
  for (const s of strategies) {
    const beforeText = isFormField
      ? (composer as HTMLTextAreaElement | HTMLInputElement).value
      : getVisibleText(composer);
    console.log('[lbab/x-writer] text before clear:', preview(normalizeComposerText(beforeText)));
    let ok = false;
    try {
      ok = s.run();
    } catch (err) {
      console.warn('[lbab/x-writer] strategy threw', s.name, err);
      ok = false;
    }
    const afterRaw = isFormField
      ? (composer as HTMLTextAreaElement | HTMLInputElement).value
      : getVisibleText(composer);
    const after = normalizeComposerText(afterRaw);
    console.log('[lbab/x-writer] insertion strategy used:', s.name);
    console.log('[lbab/x-writer] text after insert:', preview(after));
    console.log('[lbab/x-writer] exact match:', ok && after === target);
    lastActual = after;

    // Hard guard: refuse if the composer now contains the target text twice.
    const duplicateIndex = target.length > 0 ? after.indexOf(target) : -1;
    const duplicateSecond =
      target.length > 0 && duplicateIndex >= 0 && after.indexOf(target, duplicateIndex + target.length) >= 0;
    if (duplicateSecond) {
      return {
        ok: false,
        strategyUsed: s.name,
        ...baseDebug,
        actualLength: after.length,
        actualPreview: preview(after),
        duplicated: true,
        error:
          'Composer contains duplicated content after insertion; refusing to continue.',
      };
    }

    if (ok && after === target) {
      return {
        ok: true,
        strategyUsed: s.name,
        ...baseDebug,
        actualLength: after.length,
        actualPreview: preview(after),
        duplicated: false,
      };
    }
    // else: try next strategy.
  }

  return {
    ok: false,
    strategyUsed: 'none',
    ...baseDebug,
    actualLength: lastActual.length,
    actualPreview: preview(lastActual),
    duplicated: false,
    error: 'Composer text does not match target after all insertion strategies.',
  };
}

/**
 * Legacy single-shot insertion used by non-X content scripts (Gemini reader).
 * Kept for backwards compatibility. Dispatches a plain `input` event without
 * a synthetic `data` payload so framework editors do not double-apply.
 */
export function setContentEditableText(element: HTMLElement, value: string): void {
  element.focus();
  let inserted = false;
  try {
    selectElementContents(element);
    if (typeof document.execCommand === 'function') {
      try {
        document.execCommand('selectAll', false);
      } catch {
        /* ignore */
      }
      try {
        if (document.execCommand('insertText', false, value)) {
          inserted = true;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  if (!inserted) {
    element.textContent = value;
  }

  // Plain input event only — never attach a `data` field.
  dispatchPlainInput(element);
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function insertTextIntoElement(element: HTMLElement, value: string): Promise<boolean> {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    setNativeValue(element, value);
  } else if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
    setContentEditableText(element, value);
  } else {
    return false;
  }
  await new Promise((r) => setTimeout(r, 80));
  return true;
}

export function readElementText(element: HTMLElement | null): string {
  if (!element) return '';
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }
  return element.innerText ?? element.textContent ?? '';
}

/* ------------------------------------------------------------------ */
/* X.com Draft.js-specific path                                        */
/* ------------------------------------------------------------------ */

export function getXEditorText(editor: HTMLElement): string {
  // Draft.js renders text inside nested <span data-text="true">. innerText
  // composes them with proper line breaks. Normalize whitespace softly.
  const raw = editor.innerText ?? editor.textContent ?? '';
  return raw.replace(/ /g, ' ').replace(/\r\n/g, '\n').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type XInsertStrategy =
  | 'paste'
  | 'typing'
  | 'manual-needed'
  | 'none';

export interface XDraftDiagnostics {
  editorText: string;
  blockCount: number;
  dataTextSpanCount: number;
  dataTextCombinedText: string;
  htmlPreview: string;
  postButtonFound: boolean;
  postButtonEnabled: boolean;
}

export interface XInsertResult {
  ok: boolean;
  text: string;
  strategy: XInsertStrategy;
  attempts: number;
  reason?: string;
  diagnostics: XDraftDiagnostics;
}

const NORMALIZE_NBSP_RE = / /g;
const NORMALIZE_CRLF_RE = /\r\n/g;

function normalizeForCompare(t: string): string {
  return t.replace(NORMALIZE_NBSP_RE, ' ').replace(NORMALIZE_CRLF_RE, '\n').trim();
}

/**
 * Read out the actual Draft.js block/span structure so we can tell whether
 * we created real editor state or only visual DOM.
 */
export function getXDraftDiagnostics(editor: HTMLElement | null): XDraftDiagnostics {
  if (!editor) {
    return {
      editorText: '',
      blockCount: 0,
      dataTextSpanCount: 0,
      dataTextCombinedText: '',
      htmlPreview: '',
      postButtonFound: false,
      postButtonEnabled: false,
    };
  }
  const blocks = editor.querySelectorAll('.public-DraftStyleDefault-block');
  const dataTextSpans = editor.querySelectorAll('span[data-text="true"]');
  const combined: string[] = [];
  dataTextSpans.forEach((s) => {
    const t = (s as HTMLElement).textContent ?? '';
    if (t.length) combined.push(t);
  });
  const dataTextCombinedText = normalizeForCompare(combined.join('\n'));
  const html = editor.innerHTML ?? '';
  const button = findXPostButton();
  return {
    editorText: getXEditorText(editor),
    blockCount: blocks.length,
    dataTextSpanCount: dataTextSpans.length,
    dataTextCombinedText,
    htmlPreview: html.length <= 600 ? html : html.slice(0, 600) + '… [truncated]',
    postButtonFound: !!button,
    postButtonEnabled: isButtonEnabled(button),
  };
}

function logDraftDiagnostics(label: string, d: XDraftDiagnostics): void {
  console.log(`[lbab/x-writer] ${label}`, {
    editorText: d.editorText.length <= 160 ? d.editorText : d.editorText.slice(0, 160) + '…',
    blockCount: d.blockCount,
    dataTextSpanCount: d.dataTextSpanCount,
    dataTextCombined:
      d.dataTextCombinedText.length <= 160
        ? d.dataTextCombinedText
        : d.dataTextCombinedText.slice(0, 160) + '…',
    postButtonFound: d.postButtonFound,
    postButtonEnabled: d.postButtonEnabled,
  });
}

async function focusAndClickEditor(editor: HTMLElement): Promise<void> {
  try {
    editor.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch {
    /* ignore */
  }
  // Already focused inside the editor? Skip the click dance.
  if (
    document.activeElement === editor ||
    (document.activeElement instanceof HTMLElement && editor.contains(document.activeElement))
  ) {
    console.log('[lbab/x-writer] editor already focused; skipping click simulation');
    return;
  }
  try {
    const rect = editor.getBoundingClientRect();
    const cx = rect.left + Math.min(40, rect.width / 2);
    const cy = rect.top + Math.min(20, rect.height / 2);
    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: 0,
    };
    editor.dispatchEvent(new MouseEvent('mousedown', eventInit));
    editor.dispatchEvent(new MouseEvent('mouseup', eventInit));
    editor.dispatchEvent(new MouseEvent('click', eventInit));
  } catch {
    /* ignore */
  }
  try {
    editor.focus();
  } catch {
    /* ignore */
  }
  try {
    editor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  } catch {
    /* ignore */
  }
  await sleep(100);
}

async function clearXEditor(editor: HTMLElement): Promise<void> {
  const sel = window.getSelection();
  if (!sel) return;
  try {
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* ignore */
  }
  try {
    document.execCommand('selectAll', false);
  } catch {
    /* ignore */
  }
  try {
    document.execCommand('delete', false);
  } catch {
    /* ignore */
  }
  await sleep(180);
}

/**
 * Strategy 1 — synthetic ClipboardEvent('paste') with text/plain DataTransfer.
 *
 * Draft.js's `editOnPaste` reads `event.clipboardData.getData('text/plain')`
 * and inserts content via its own model, producing real
 * `.public-DraftStyleDefault-block` + `<span data-text="true">` structure.
 *
 * Some Chromium versions silently ignore `clipboardData` on synthetic events;
 * this strategy returns failure quickly so the caller can try typing.
 */
async function pasteIntoXDraftEditor(
  editor: HTMLElement,
  target: string,
): Promise<{ ok: boolean; reason?: string }> {
  await focusAndClickEditor(editor);
  await clearXEditor(editor);
  console.log('[lbab/x-writer] strategy=paste: dispatching ClipboardEvent', { length: target.length });

  // Build a DataTransfer with the target text.
  let dt: DataTransfer;
  try {
    dt = new DataTransfer();
    dt.setData('text/plain', target);
  } catch (err) {
    return { ok: false, reason: `DataTransfer construction failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  let pasteEvent: ClipboardEvent;
  try {
    pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
  } catch (err) {
    return { ok: false, reason: `ClipboardEvent construction failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Some Chromium builds reset clipboardData on construction. Patch it back
  // explicitly so Draft.js's handler can read getData().
  try {
    if (!pasteEvent.clipboardData || pasteEvent.clipboardData.getData('text/plain') !== target) {
      Object.defineProperty(pasteEvent, 'clipboardData', { value: dt });
    }
  } catch {
    /* ignore — best effort */
  }

  let dispatched = false;
  try {
    dispatched = editor.dispatchEvent(pasteEvent);
  } catch (err) {
    return { ok: false, reason: `dispatchEvent threw: ${err instanceof Error ? err.message : String(err)}` };
  }

  await sleep(700);
  return { ok: dispatched };
}

/**
 * Strategy 2 — chunked execCommand insertText. Driving Draft.js's
 * beforeinput pipeline with smaller chunks gives the model time to apply
 * and re-render between chunks.
 */
async function typeIntoXDraftEditor(
  editor: HTMLElement,
  target: string,
): Promise<{ ok: boolean; reason?: string }> {
  await focusAndClickEditor(editor);
  await clearXEditor(editor);
  console.log('[lbab/x-writer] strategy=typing: chunked execCommand insertText', {
    length: target.length,
  });

  const CHUNK = 60;
  for (let i = 0; i < target.length; i += CHUNK) {
    const chunk = target.slice(i, i + CHUNK);
    let okStep = false;
    try {
      okStep = document.execCommand('insertText', false, chunk);
    } catch (err) {
      return { ok: false, reason: `insertText threw: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!okStep) {
      return { ok: false, reason: 'execCommand("insertText") returned false on X.' };
    }
    // Brief settle between chunks so Draft.js's model + render keeps up.
    await sleep(15);
  }
  await sleep(700);
  return { ok: true };
}

function isInsertionAccepted(diagnostics: XDraftDiagnostics, target: string): boolean {
  // True success only when Draft.js produced its real block/span structure
  // AND visible text exactly equals target.
  if (diagnostics.editorText !== target) return false;
  if (diagnostics.dataTextSpanCount === 0) return false;
  // dataTextCombinedText might collapse newlines differently than innerText.
  // Accept either an exact match or the target appearing inside the combined.
  if (
    diagnostics.dataTextCombinedText !== target &&
    diagnostics.dataTextCombinedText.indexOf(target) < 0
  ) {
    return false;
  }
  return true;
}

function findDuplicate(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const i = haystack.indexOf(needle);
  if (i < 0) return false;
  return haystack.indexOf(needle, i + needle.length) >= 0;
}

/**
 * Orchestrates the X insertion pipeline: clipboard paste → chunked typing
 * → manual-click error. Verifies real Draft.js structure after each step.
 */
export async function insertIntoXDraftEditor(
  editor: HTMLElement,
  rawText: string,
): Promise<XInsertResult> {
  const target = normalizeForCompare(rawText);
  console.log('[lbab/x-writer] X Draft editor selected');
  let attempts = 0;
  let lastReason: string | undefined;

  // ---- Strategy 1: paste ----
  attempts += 1;
  const pasteOutcome = await pasteIntoXDraftEditor(editor, target);
  let diag = getXDraftDiagnostics(editor);
  logDraftDiagnostics('after paste', diag);
  if (findDuplicate(diag.editorText, target) || findDuplicate(diag.dataTextCombinedText, target)) {
    return {
      ok: false,
      strategy: 'paste',
      attempts,
      text: diag.editorText,
      reason: 'X composer contains duplicated content after insertion.',
      diagnostics: diag,
    };
  }
  if (pasteOutcome.ok && isInsertionAccepted(diag, target)) {
    return { ok: true, strategy: 'paste', attempts, text: diag.editorText, diagnostics: diag };
  }
  lastReason = pasteOutcome.reason ?? 'Paste did not produce real Draft.js block/span structure.';
  console.log('[lbab/x-writer] paste strategy did not produce real Draft.js content; trying typing fallback');

  // ---- Strategy 2: chunked typing ----
  attempts += 1;
  const typeOutcome = await typeIntoXDraftEditor(editor, target);
  diag = getXDraftDiagnostics(editor);
  logDraftDiagnostics('after typing', diag);
  if (findDuplicate(diag.editorText, target) || findDuplicate(diag.dataTextCombinedText, target)) {
    return {
      ok: false,
      strategy: 'typing',
      attempts,
      text: diag.editorText,
      reason: 'X composer contains duplicated content after insertion.',
      diagnostics: diag,
    };
  }
  if (typeOutcome.ok && isInsertionAccepted(diag, target)) {
    return { ok: true, strategy: 'typing', attempts, text: diag.editorText, diagnostics: diag };
  }
  if (!typeOutcome.ok) lastReason = typeOutcome.reason ?? lastReason;
  if (
    typeOutcome.ok &&
    diag.editorText === target &&
    diag.dataTextSpanCount === 0
  ) {
    lastReason = 'Editor visible text matched target but no Draft.js span[data-text="true"] was created (overlay state).';
  }

  // ---- Strategy 3: manual-needed ----
  return {
    ok: false,
    strategy: 'manual-needed',
    attempts,
    text: diag.editorText,
    reason:
      'X composer did not accept automated input. Click inside the X composer manually, then press Post next item now again.',
    diagnostics: diag,
  };
}

export function findXPostButton(): HTMLButtonElement | null {
  const sels = [
    'button[data-testid="tweetButtonInline"]',
    'button[data-testid="tweetButton"]',
  ];
  for (const sel of sels) {
    const matches = Array.from(document.querySelectorAll<HTMLButtonElement>(sel));
    for (const b of matches) {
      const rect = b.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return b;
    }
  }
  // Text fallback — visible buttons whose text is exactly "Post" or "Tweet".
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button[role="button"]'));
  for (const b of buttons) {
    const rect = b.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const txt = (b.textContent ?? '').trim().toLowerCase();
    if (txt === 'post' || txt === 'tweet') return b as HTMLButtonElement;
  }
  return null;
}

export function isButtonEnabled(button: HTMLButtonElement | null): boolean {
  if (!button) return false;
  // Honest disabled signals only — we do NOT use tabindex/CSS classes/colors.
  if (button.disabled) return false;
  if (button.hasAttribute('disabled')) return false;
  if (button.getAttribute('aria-disabled') === 'true') return false;
  // Visibility check: X's Post button has non-zero box when it's actionable.
  const rect = button.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

/**
 * Poll for the X Post button to become enabled. After Draft.js inserts text,
 * X's React parent runs validation (length, account state, etc.) and flips
 * the button's disabled flag on a later tick. Polling avoids the false
 * "still disabled" reading that we'd otherwise see if we checked too soon.
 */
export async function waitForXPostButtonEnabled(
  timeoutMs = 3000,
  pollMs = 100,
): Promise<HTMLButtonElement | null> {
  console.log('[lbab/x-writer] waiting for X post button to become enabled');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const btn = findXPostButton();
    if (btn && isButtonEnabled(btn)) {
      console.log(`[lbab/x-writer] post button enabled after ${Date.now() - start} ms`);
      return btn;
    }
    await sleep(pollMs);
  }
  console.warn('[lbab/x-writer] post button did not enable within timeout', { timeoutMs });
  return null;
}

/**
 * Dispatch a realistic Ctrl+Enter (or Meta+Enter) sequence on the X Draft.js
 * editor. This is X's documented submit shortcut and is empirically the
 * most reliable way to submit posts when the Inline Post button click does
 * not register through React's synthetic event system.
 *
 * The sequence mirrors what the browser fires for a real user keypress:
 *   1. keydown Control / Meta (alone)
 *   2. keydown Enter with the modifier flag set
 *   3. keyup   Enter with the modifier flag set
 *   4. keyup   Control / Meta
 *
 * Does NOT spam — exactly one Enter keydown / keyup. Caller controls
 * single-shot semantics via operationId guards.
 */
export async function submitXWithCtrlEnter(
  editor: HTMLElement,
  modifier: 'ctrl' | 'meta' = 'ctrl',
): Promise<void> {
  const useMeta = modifier === 'meta';
  const modifierKey = useMeta ? 'Meta' : 'Control';
  const modifierCode = useMeta ? 'MetaLeft' : 'ControlLeft';

  console.log(`[lbab/x-writer] dispatching ${useMeta ? 'Meta' : 'Ctrl'}+Enter`);

  // Make sure the editor is focused so document.activeElement is the
  // Draft.js content node — Draft.js attaches its keydown handler to the
  // editor and to the document via React's delegation.
  try {
    editor.focus();
  } catch {
    /* ignore */
  }
  // Place a caret at the end of the contents in case selection got lost
  // (Draft.js needs a non-collapsed-elsewhere selection to commit submit).
  try {
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false); // caret at end
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch {
    /* ignore */
  }

  const baseInit = (key: string, code: string, modOn: boolean): KeyboardEventInit => ({
    key,
    code,
    bubbles: true,
    cancelable: true,
    composed: true,
    keyCode: key === 'Enter' ? 13 : useMeta ? 91 : 17,
    which: key === 'Enter' ? 13 : useMeta ? 91 : 17,
    ctrlKey: !useMeta && modOn,
    metaKey: useMeta && modOn,
  });

  const targets: EventTarget[] = [editor];
  if (
    document.activeElement &&
    document.activeElement !== editor &&
    document.activeElement instanceof HTMLElement
  ) {
    targets.push(document.activeElement);
  }
  // Fall back to document so React's root-level delegation also sees the event.
  targets.push(document);

  function fire(type: 'keydown' | 'keyup' | 'keypress', key: string, code: string, modOn: boolean) {
    const init = baseInit(key, code, modOn);
    for (const t of targets) {
      try {
        t.dispatchEvent(new KeyboardEvent(type, init));
      } catch {
        /* ignore */
      }
    }
  }

  // 1) Control/Meta down (no Enter yet).
  fire('keydown', modifierKey, modifierCode, true);
  await sleep(20);
  // 2) Enter down with modifier held.
  fire('keydown', 'Enter', 'Enter', true);
  // 3) keypress is omitted by modern Chrome for non-printable keys; skip.
  // 4) Enter up with modifier still held.
  fire('keyup', 'Enter', 'Enter', true);
  await sleep(20);
  // 5) Control/Meta up.
  fire('keyup', modifierKey, modifierCode, false);
}

/**
 * Poll for visible signs that the X composer's submit happened. Returns
 * `{ ok: true }` on the first strong indicator; `{ ok: false }` on timeout.
 *
 * Strong indicators (any one is enough):
 *   - editor element disconnected from DOM
 *   - editor visible text became empty
 *   - editor no longer contains the original text AND looks reset
 *   - the post button disappeared from the DOM
 */
export async function waitForXSubmission(
  editor: HTMLElement,
  originalText: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; elapsedMs: number; reason?: string }> {
  const start = Date.now();
  const target = (originalText ?? '').trim();
  while (Date.now() - start < timeoutMs) {
    // (1) Editor disconnected → strong signal.
    if (!editor.isConnected) {
      return { ok: true, elapsedMs: Date.now() - start, reason: 'editor-detached' };
    }
    // (2) Editor cleared (empty visible text).
    let current = '';
    try {
      current = (editor.innerText ?? editor.textContent ?? '').replace(/ /g, ' ').trim();
    } catch {
      current = '';
    }
    if (current.length === 0) {
      return { ok: true, elapsedMs: Date.now() - start, reason: 'editor-cleared' };
    }
    // (3) Original text gone and editor looks like a placeholder/short reset.
    if (target.length > 0 && !current.includes(target) && current.length < 8) {
      return { ok: true, elapsedMs: Date.now() - start, reason: 'editor-reset' };
    }
    // (4) Post button disappeared.
    const btn = findXPostButton();
    if (!btn || !btn.isConnected) {
      return { ok: true, elapsedMs: Date.now() - start, reason: 'post-button-gone' };
    }
    await sleep(250);
  }
  return { ok: false, elapsedMs: Date.now() - start, reason: 'timeout' };
}

/**
 * Robust single click for the X Post button. Dispatches the full mouse
 * sequence so React's synthetic-event delegation registers a real user
 * gesture, then calls .click() once. NEVER clicks twice.
 */
export async function clickXPostButton(button: HTMLButtonElement): Promise<void> {
  try {
    button.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch {
    /* ignore */
  }
  const rect = button.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: cx,
    clientY: cy,
    button: 0,
  };
  try {
    button.dispatchEvent(new MouseEvent('mouseover', eventInit));
    button.dispatchEvent(new MouseEvent('mousedown', eventInit));
    button.dispatchEvent(new MouseEvent('mouseup', eventInit));
  } catch (err) {
    console.warn('[lbab/x-writer] mouse-event dispatch threw', err);
  }
  console.log('[lbab/x-writer] clicking post button once');
  button.click();
  console.log('[lbab/x-writer] post button clicked');
}
