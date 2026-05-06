export function isVisible(el: Element | null): boolean {
  if (!el) return false;
  const html = el as HTMLElement;
  const rect = html.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(html);
  if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
  return true;
}

export function findVisibleElement(selectors: string[], timeoutMs = 0): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const tryFind = (): HTMLElement | null => {
      for (const sel of selectors) {
        const matches = Array.from(document.querySelectorAll<HTMLElement>(sel));
        for (const el of matches) {
          if (isVisible(el)) return el;
        }
      }
      return null;
    };
    const immediate = tryFind();
    if (immediate || timeoutMs <= 0) {
      resolve(immediate);
      return;
    }
    const start = Date.now();
    const interval = window.setInterval(() => {
      const found = tryFind();
      if (found || Date.now() - start >= timeoutMs) {
        window.clearInterval(interval);
        resolve(found);
      }
    }, 200);
  });
}

export function findButtonByText(texts: string[]): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
  const lc = texts.map((t) => t.toLowerCase());
  for (const b of buttons) {
    if (!isVisible(b)) continue;
    const txt = (b.textContent ?? '').trim().toLowerCase();
    if (!txt) continue;
    if (lc.some((t) => txt === t || txt.startsWith(t))) return b;
  }
  return null;
}
