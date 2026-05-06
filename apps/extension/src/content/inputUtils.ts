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

export function setContentEditableText(element: HTMLElement, value: string): void {
  element.focus();
  // Try selectAll + insertText path
  let inserted = false;
  try {
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(element);
      sel.addRange(range);
    }
    if (typeof document.execCommand === 'function') {
      try {
        document.execCommand('selectAll', false);
      } catch {
        // ignore
      }
      try {
        if (document.execCommand('insertText', false, value)) {
          inserted = true;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  if (!inserted) {
    // Fallback: set textContent directly.
    element.textContent = value;
  }

  element.dispatchEvent(
    new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }),
  );
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
