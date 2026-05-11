import {
  SOURCE_FETCH_TIMEOUT_MS,
  SOURCE_MAX_BYTES,
  SOURCE_CONTEXT_MAX_CHARS,
} from '@lbab/shared';
import { logService } from './logService.js';
import { settingsService } from './settingsService.js';
import { contentSourceService } from './contentSourceService.js';
import { extractFromHtml, type ExtractionMethod, cleanExtractedText } from './htmlExtractor.js';

export interface SourceContext {
  sourceId: number | null;
  sourceLabel: string | null;
  url: string | null;
  finalUrl: string | null;
  title: string | null;
  text: string;
  method: ExtractionMethod;
  contentType?: string;
  status?: number;
  size?: number;
  preview: string;
  categoryId: number | null;
  categoryName: string | null;
  categorySlug: string | null;
}

const PRIVATE_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::1', '[::1]']);
const PRIVATE_IP_PREFIXES = [/^127\./, /^10\./, /^192\.168\./];
const PRIVATE_172_RE = /^172\.(1[6-9]|2\d|3[01])\./;

export function isAllowedSourceUrl(raw: string): { ok: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Protocol ${url.protocol} not allowed` };
  }
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(host)) {
    return { ok: false, reason: `Hostname ${host} is private` };
  }
  if (PRIVATE_IP_PREFIXES.some((re) => re.test(host)) || PRIVATE_172_RE.test(host)) {
    return { ok: false, reason: `IP ${host} is in a private range` };
  }
  if (host.startsWith('[fe80') || host === '[::]') {
    return { ok: false, reason: `IPv6 ${host} is private` };
  }
  return { ok: true };
}

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; LocalBrowserAutomationBridge/0.1; +https://github.com/atj393/local-browser-automation-bridge)',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-IN,en;q=0.9,ta-IN;q=0.8,ta;q=0.7',
};

function looksLikeRss(text: string, contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (
    ct.includes('rss') ||
    ct.includes('atom') ||
    ct.includes('application/xml') ||
    ct.includes('text/xml')
  ) {
    return true;
  }
  const head = text.slice(0, 4096).toLowerCase();
  return /<rss\b|<feed\b|<rdf:rdf\b/.test(head);
}

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

function extractTagText(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m || !m[1]) return undefined;
  const cleaned = cleanExtractedText(stripHtmlTags(stripCdata(m[1])));
  return cleaned.length ? cleaned : undefined;
}

function parseRss(text: string, max = 8): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(text)) && items.length < max) {
    const block = match[2] ?? '';
    const title = extractTagText(block, 'title');
    const link =
      extractTagText(block, 'link') ?? block.match(/<link[^>]*href=['"]([^'"]+)['"]/i)?.[1];
    const description =
      extractTagText(block, 'description') ??
      extractTagText(block, 'summary') ??
      extractTagText(block, 'content');
    const pubDate =
      extractTagText(block, 'pubDate') ??
      extractTagText(block, 'published') ??
      extractTagText(block, 'updated');
    if (title || description || link) items.push({ title, link, description, pubDate });
  }
  return items;
}

function rssToContext(items: RssItem[]): string {
  return items
    .map((it, i) => {
      const lines: string[] = [`[${i + 1}] ${it.title ?? '(no title)'}`];
      if (it.pubDate) lines.push(`  date: ${it.pubDate}`);
      if (it.link) lines.push(`  link: ${it.link}`);
      if (it.description) {
        const desc = it.description.length > 600 ? it.description.slice(0, 600) + '…' : it.description;
        lines.push(`  ${desc}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

interface FetchOk {
  ok: true;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  size: number;
}
interface FetchErr {
  ok: false;
  finalUrl?: string;
  status?: number;
  error: string;
}

async function fetchSource(url: string): Promise<FetchOk | FetchErr> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: REQUEST_HEADERS,
      redirect: 'follow',
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.url,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    if (!res.body) return { ok: false, error: 'Empty response body' };

    // Re-validate redirected URL still passes SSRF rules.
    const finalUrlCheck = isAllowedSourceUrl(res.url);
    if (!finalUrlCheck.ok) {
      return {
        ok: false,
        finalUrl: res.url,
        error: `Redirected to disallowed URL: ${finalUrlCheck.reason}`,
      };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let exceeded = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > SOURCE_MAX_BYTES) {
          exceeded = true;
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
        chunks.push(value);
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
    const body = buf.toString('utf8');
    const contentType = res.headers.get('content-type') ?? '';
    if (exceeded) {
      logService.warn('Source response exceeded size cap; using truncated body.', {
        url,
        cap: SOURCE_MAX_BYTES,
        observed: total,
      });
    }
    return {
      ok: true,
      finalUrl: res.url,
      status: res.status,
      contentType,
      body,
      size: total,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function chooseSourceUrl(
  urls: string[],
  mode: 'rotate' | 'first' | 'none',
  lastIndex: number,
): { url: string | null; index: number } {
  if (mode === 'none' || urls.length === 0) return { url: null, index: -1 };
  if (mode === 'first') return { url: urls[0] ?? null, index: 0 };
  const next = (lastIndex + 1) % urls.length;
  return { url: urls[next] ?? null, index: next };
}

/**
 * Public test API used by both the prompt service (for the live generation
 * path) and the /api/sources/test endpoint (for debugging / Settings UI).
 */
function emptyContext(
  rawUrl: string | null,
  partial: Partial<SourceContext> = {},
): SourceContext {
  return {
    sourceId: null,
    sourceLabel: null,
    url: rawUrl,
    finalUrl: null,
    title: null,
    text: '',
    method: 'none',
    preview: '',
    categoryId: null,
    categoryName: null,
    categorySlug: null,
    ...partial,
  };
}

export async function fetchAndExtractSource(rawUrl: string): Promise<SourceContext> {
  logService.info('Source fetch started.', { url: rawUrl });
  const allowed = isAllowedSourceUrl(rawUrl);
  if (!allowed.ok) {
    return emptyContext(rawUrl);
  }

  const fetched = await fetchSource(rawUrl);
  if (!fetched.ok) {
    logService.warn('Source fetch failed.', { url: rawUrl, error: fetched.error });
    return emptyContext(rawUrl, {
      finalUrl: fetched.finalUrl ?? null,
      status: fetched.status,
    });
  }

  logService.info('Source fetch completed.', {
    url: rawUrl,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    contentType: fetched.contentType,
    size: fetched.size,
  });

  if (looksLikeRss(fetched.body, fetched.contentType)) {
    const items = parseRss(fetched.body, 8);
    const text = rssToContext(items);
    const isAtom = /<feed\b/i.test(fetched.body.slice(0, 4096));
    const method: ExtractionMethod = isAtom ? 'atom-feed' : 'rss-feed';
    const finalText = text.slice(0, SOURCE_CONTEXT_MAX_CHARS);
    logService.info('Source extraction method: feed.', {
      method,
      items: items.length,
      length: finalText.length,
    });
    return emptyContext(rawUrl, {
      finalUrl: fetched.finalUrl,
      title: items[0]?.title ?? null,
      text: finalText,
      method,
      contentType: fetched.contentType,
      status: fetched.status,
      size: fetched.size,
      preview: finalText.slice(0, 200),
    });
  }

  const ext = extractFromHtml(fetched.body, fetched.finalUrl);
  logService.info('Source extraction method:', {
    method: ext.method,
    candidates: ext.diagnostics.candidateMethods,
    extractedLength: ext.text.length,
    title: ext.title,
    htmlLength: ext.diagnostics.htmlLength,
    fallbackReason: ext.diagnostics.fallbackReason,
  });

  return emptyContext(rawUrl, {
    finalUrl: fetched.finalUrl,
    title: ext.title,
    text: ext.text,
    method: ext.method,
    contentType: fetched.contentType,
    status: fetched.status,
    size: fetched.size,
    preview: ext.text.slice(0, 200),
  });
}

export const sourceService = {
  isAllowedSourceUrl,
  fetchAndExtractSource,

  /**
   * Choose the next enabled content_source and fetch its content. Persists
   * `last_source_id` (and `last_source_url`) after the fetch — success or
   * failure — so rotation always advances. Returns an empty context when
   * no source is selected.
   */
  async getNextSourceContext(): Promise<SourceContext> {
    const settings = settingsService.get();
    const source = contentSourceService.chooseNext(settings.sourceMode, settings.lastSourceId);

    if (!source) {
      logService.info('Source: none selected (mode/none or no enabled sources).', {
        mode: settings.sourceMode,
        enabledSources: contentSourceService.listEnabled().length,
      });
      return emptyContext(null);
    }

    logService.info('Source: chose next.', {
      sourceId: source.id,
      sourceUrl: source.url,
      categoryId: source.categoryId,
      categoryName: source.categoryName,
      mode: settings.sourceMode,
    });

    const fetched = await fetchAndExtractSource(source.url);
    const ctx: SourceContext = {
      ...fetched,
      sourceId: source.id,
      sourceLabel: source.label,
      categoryId: source.categoryId,
      categoryName: source.categoryName,
      categorySlug: source.categorySlug,
    };

    settingsService.setSourceProgress(source.id, source.url);
    contentSourceService.markUsed(
      source.id,
      ctx.text.length > 0 ? 'ok' : 'error',
      ctx.text.length > 0 ? null : 'No usable content extracted.',
    );

    return ctx;
  },
};

// Re-export for chooseSourceUrl callers that may still depend on its presence.
export { chooseSourceUrl };
