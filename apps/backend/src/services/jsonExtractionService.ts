import type { NormalizedItem } from '@lbab/shared';

const ITEM_FIELDS = ['content', 'text', 'post', 'message'] as const;

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stripFences(text: string): string {
  let t = text.trim();
  // Remove ```json ... ``` or ``` ... ```
  const fenceMatch = t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();
  // Remove leading/trailing single backticks
  t = t.replace(/^`+|`+$/g, '').trim();
  return t;
}

function extractFirstJsonBlock(text: string): unknown {
  // Try array first
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const v = tryParse(arrMatch[0]);
    if (v !== undefined) return v;
  }
  // Try object
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const v = tryParse(objMatch[0]);
    if (v !== undefined) return v;
  }
  return undefined;
}

function pickItemContent(obj: unknown): string | null {
  if (typeof obj === 'string') {
    const s = obj.trim();
    return s.length ? s : null;
  }
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    for (const key of ITEM_FIELDS) {
      const v = o[key];
      if (typeof v === 'string' && v.trim().length) return v.trim();
    }
  }
  return null;
}

function arrayToItems(arr: unknown[]): NormalizedItem[] {
  const items: NormalizedItem[] = [];
  for (const entry of arr) {
    const c = pickItemContent(entry);
    if (c) items.push({ content: c, raw: entry });
  }
  return items;
}

export const jsonExtractionService = {
  extract(rawText: string): { items: NormalizedItem[]; error?: string; preview: string } {
    const preview = (rawText ?? '').slice(0, 1000);
    if (!rawText || !rawText.trim()) {
      return { items: [], error: 'Empty Gemini response.', preview };
    }
    const cleaned = stripFences(rawText);

    let parsed: unknown = tryParse(cleaned);
    if (parsed === undefined) parsed = extractFirstJsonBlock(cleaned);
    if (parsed === undefined) parsed = extractFirstJsonBlock(rawText);

    if (parsed === undefined) {
      return {
        items: [],
        error: 'Could not parse Gemini response as JSON.',
        preview,
      };
    }

    // Normalize various shapes
    let items: NormalizedItem[] = [];
    if (Array.isArray(parsed)) {
      items = arrayToItems(parsed);
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const candidates = [obj.items, obj.posts, obj.results, obj.data];
      for (const cand of candidates) {
        if (Array.isArray(cand)) {
          items = arrayToItems(cand);
          if (items.length) break;
        }
      }
      if (!items.length) {
        // Maybe a single item shape
        const single = pickItemContent(parsed);
        if (single) items = [{ content: single, raw: parsed }];
      }
    }

    if (!items.length) {
      return { items: [], error: 'JSON parsed but no usable items found.', preview };
    }
    return { items, preview };
  },
};
