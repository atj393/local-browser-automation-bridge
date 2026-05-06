/**
 * Layered HTML extractor for source URLs.
 *
 * Pipeline (in order; first one with usable content wins):
 *   1. JSON-LD       — schema.org NewsArticle / Article / BlogPosting / WebPage / ItemList
 *   2. Mozilla Readability — works well for article pages
 *   3. OpenGraph + meta description — covers many homepages
 *   4. Cheerio fallback — h1/h2/h3 + main/article paragraphs
 *   5. Homepage-links fallback — list of headline links found on the page
 *
 * If 1 succeeds with reasonable text, we still also extract homepage links
 * so news index pages return both summary text and story headlines.
 */
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';
import { decode } from 'html-entities';

import { SOURCE_CONTEXT_MAX_CHARS } from '@lbab/shared';

export type ExtractionMethod =
  | 'json-ld'
  | 'readability'
  | 'og-meta'
  | 'cheerio'
  | 'homepage-links'
  | 'rss-feed'
  | 'atom-feed'
  | 'html-fallback'
  | 'none';

export interface HtmlExtractResult {
  ok: boolean;
  method: ExtractionMethod;
  title: string | null;
  text: string;
  links: { title: string; url: string }[];
  diagnostics: {
    htmlLength: number;
    candidateMethods: ExtractionMethod[];
    fallbackReason?: string;
  };
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '… [truncated]';
}

function collapseWhitespace(s: string): string {
  return s.replace(/[ \t ]+/g, ' ').replace(/\n[ \t]+/g, '\n').trim();
}

function dedupeLines(s: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of s.split('\n')) {
    const line = raw.trim();
    if (!line) {
      // Preserve blank-line separation, but only one in a row.
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  // Trim trailing blank lines.
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

export function cleanExtractedText(text: string): string {
  if (!text) return '';
  let s = decode(text);
  // Strip stray HTML tags if any leaked in.
  s = s.replace(/<[^>]+>/g, ' ');
  s = collapseWhitespace(s);
  s = dedupeLines(s);
  return s.trim();
}

function safeAbs(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

// ---- Strategy 1: JSON-LD ------------------------------------------------

interface JsonLdHit {
  title?: string;
  description?: string;
  body?: string;
  itemList?: { name: string; url?: string }[];
}

function flattenLd(node: unknown, out: unknown[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) flattenLd(n, out);
    return;
  }
  if (typeof node === 'object') {
    out.push(node);
    const o = node as Record<string, unknown>;
    if (o['@graph']) flattenLd(o['@graph'], out);
  }
}

function extractJsonLd($: cheerio.CheerioAPI, base: string): JsonLdHit | null {
  const blocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    const txt = $(el).contents().text();
    if (!txt) return;
    try {
      const parsed = JSON.parse(txt);
      flattenLd(parsed, blocks);
    } catch {
      // Some sites embed multiple JSON objects separated incorrectly; ignore.
    }
  });
  if (!blocks.length) return null;

  let title: string | undefined;
  let description: string | undefined;
  let body: string | undefined;
  const itemList: { name: string; url?: string }[] = [];

  for (const block of blocks) {
    const o = block as Record<string, unknown>;
    const type = String(o['@type'] ?? '');
    const types = Array.isArray(o['@type'])
      ? (o['@type'] as string[]).join(',')
      : type;

    if (/Article|NewsArticle|BlogPosting|WebPage/i.test(types)) {
      const headline = (o.headline ?? o.name) as string | undefined;
      const desc = (o.description ?? o.abstract) as string | undefined;
      const article = o.articleBody as string | undefined;
      if (headline && !title) title = headline;
      if (desc && !description) description = desc;
      if (article && !body) body = article;
    }

    if (/ItemList/i.test(types)) {
      const items = (o.itemListElement ?? o.itemList ?? []) as unknown[];
      if (Array.isArray(items)) {
        for (const it of items) {
          const x = it as Record<string, unknown>;
          const item = (x.item ?? x) as Record<string, unknown>;
          const name = (item.name ?? item.headline) as string | undefined;
          const url = item.url as string | undefined;
          if (name) itemList.push({ name: String(name), url: safeAbs(url, base) ?? url });
        }
      }
    }
  }

  if (!title && !description && !body && itemList.length === 0) return null;
  return { title, description, body, itemList };
}

// ---- Strategy 2: Readability --------------------------------------------

interface ReadabilityHit {
  title: string | null;
  text: string;
}

function extractReadability(html: string, url: string): ReadabilityHit | null {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article) return null;
    const text = (article.textContent ?? '').trim();
    if (text.length < 200) return null; // too thin for an article
    return { title: article.title ?? null, text };
  } catch {
    return null;
  }
}

// ---- Strategy 3: OG / meta ----------------------------------------------

interface OgMetaHit {
  title: string | null;
  description: string | null;
}

function extractOgMeta($: cheerio.CheerioAPI): OgMetaHit | null {
  const ogTitle =
    $('meta[property="og:title"]').attr('content') ??
    $('meta[name="twitter:title"]').attr('content') ??
    $('meta[name="title"]').attr('content') ??
    $('title').first().text();
  const ogDesc =
    $('meta[property="og:description"]').attr('content') ??
    $('meta[name="twitter:description"]').attr('content') ??
    $('meta[name="description"]').attr('content');
  const title = ogTitle?.trim() ? ogTitle.trim() : null;
  const description = ogDesc?.trim() ? ogDesc.trim() : null;
  if (!title && !description) return null;
  return { title, description };
}

// ---- Strategy 4: Cheerio fallback (article body via heuristics) ---------

const CONTAINER_PRIORITY = [
  'article',
  'main',
  '[role="main"]',
  '.content',
  '.post',
  '.story',
  '.news',
  '.article',
];

function extractCheerioBody($: cheerio.CheerioAPI): string {
  // Drop noise first.
  $('script, style, noscript, svg, iframe, header, footer, nav, aside, form, button, input, select, textarea').remove();

  let container: cheerio.Cheerio<any> | null = null;
  for (const sel of CONTAINER_PRIORITY) {
    const found = $(sel).first();
    if (found.length && found.text().trim().length >= 200) {
      container = found;
      break;
    }
  }
  const root = container ?? $('body');

  const lines: string[] = [];
  const headline = root.find('h1').first().text().trim();
  if (headline) lines.push(headline);

  root.find('h2, h3').each((_i, el) => {
    const t = $(el).text().trim();
    if (t.length >= 8) lines.push(t);
  });

  root.find('p, li').each((_i, el) => {
    const t = $(el).text().trim();
    if (t.length >= 30) lines.push(t);
  });

  return lines.join('\n');
}

// ---- Strategy 5: homepage-links fallback --------------------------------

interface LinkHit {
  title: string;
  url: string;
}

function extractHomepageLinks($: cheerio.CheerioAPI, base: string, max = 30): LinkHit[] {
  const seen = new Set<string>();
  const out: LinkHit[] = [];

  // Prefer headline-style anchors first.
  const orderedSelectors = ['h2 a[href]', 'h3 a[href]', 'h4 a[href]', 'article a[href]', 'a[href]'];
  for (const sel of orderedSelectors) {
    $(sel).each((_i, el) => {
      const $a = $(el);
      const text = $a.text().trim();
      if (text.length < 20 || text.length > 220) return;
      const href = $a.attr('href');
      const abs = safeAbs(href, base);
      if (!abs) return;
      // Same-origin only — avoids ad/affiliate links from another domain.
      try {
        const u = new URL(abs);
        const b = new URL(base);
        if (u.host !== b.host && !u.host.endsWith('.' + b.host)) return;
      } catch {
        return;
      }
      const key = (text + '|' + abs).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ title: text, url: abs });
    });
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

// ---- Top-level orchestration --------------------------------------------

function methodPriority(): ExtractionMethod[] {
  return ['json-ld', 'readability', 'og-meta', 'cheerio', 'homepage-links'];
}

export function extractFromHtml(html: string, finalUrl: string): HtmlExtractResult {
  const candidateMethods: ExtractionMethod[] = [];
  const $ = cheerio.load(html);

  // 1) JSON-LD ------------------------------------------------------------
  const ld = extractJsonLd($, finalUrl);
  if (ld) candidateMethods.push('json-ld');

  // 2) Readability --------------------------------------------------------
  const readable = extractReadability(html, finalUrl);
  if (readable) candidateMethods.push('readability');

  // 3) OG / meta ----------------------------------------------------------
  const og = extractOgMeta($);
  if (og) candidateMethods.push('og-meta');

  // 4) Cheerio body -------------------------------------------------------
  const cheerioText = extractCheerioBody($);
  if (cheerioText.length >= 200) candidateMethods.push('cheerio');

  // 5) Homepage links -----------------------------------------------------
  const links = extractHomepageLinks($, finalUrl);
  if (links.length >= 3) candidateMethods.push('homepage-links');

  // Choose method.
  // Article-shaped pages: prefer readability or json-ld with body.
  // Homepages: prefer homepage-links + og-meta.
  let chosen: ExtractionMethod = 'none';
  let title: string | null = null;
  let textParts: string[] = [];

  if (readable && readable.text.length >= 400) {
    chosen = 'readability';
    title = readable.title ?? og?.title ?? ld?.title ?? null;
    textParts.push(cleanExtractedText(readable.text));
  } else if (ld && (ld.body || ld.description)) {
    chosen = 'json-ld';
    title = ld.title ?? og?.title ?? null;
    if (ld.title) textParts.push(`Title: ${ld.title}`);
    if (ld.description) textParts.push(`Summary: ${ld.description}`);
    if (ld.body) textParts.push(cleanExtractedText(ld.body));
  } else if (cheerioText.length >= 400) {
    chosen = 'cheerio';
    title = og?.title ?? ld?.title ?? null;
    if (og?.title) textParts.push(`Title: ${og.title}`);
    if (og?.description) textParts.push(`Summary: ${og.description}`);
    textParts.push(cleanExtractedText(cheerioText));
  } else if (links.length >= 3) {
    chosen = 'homepage-links';
    title = og?.title ?? ld?.title ?? null;
    if (og?.title) textParts.push(`Title: ${og.title}`);
    if (og?.description) textParts.push(`Summary: ${og.description}`);
    textParts.push('Top stories found:');
    links.forEach((l, i) => textParts.push(`${i + 1}. ${l.title} — ${l.url}`));
  } else if (og && (og.title || og.description)) {
    chosen = 'og-meta';
    title = og.title;
    if (og.title) textParts.push(`Title: ${og.title}`);
    if (og.description) textParts.push(`Summary: ${og.description}`);
  } else if (ld) {
    chosen = 'json-ld';
    title = ld.title ?? null;
    if (ld.title) textParts.push(`Title: ${ld.title}`);
    if (ld.description) textParts.push(`Summary: ${ld.description}`);
    if (ld.itemList?.length) {
      textParts.push('Items:');
      ld.itemList.slice(0, 30).forEach((it, i) => {
        textParts.push(`${i + 1}. ${it.name}${it.url ? ' — ' + it.url : ''}`);
      });
    }
  } else if (cheerioText.length > 0) {
    chosen = 'cheerio';
    title = og?.title ?? null;
    textParts.push(cleanExtractedText(cheerioText));
  }

  // If we picked an article method but the page is also a list, append top
  // links so prompts get richer context for news sites.
  if ((chosen === 'readability' || chosen === 'json-ld' || chosen === 'cheerio') && links.length >= 5) {
    textParts.push('');
    textParts.push('Other stories on this page:');
    links.slice(0, 10).forEach((l, i) => textParts.push(`${i + 1}. ${l.title}`));
  }

  const finalText = clamp(cleanExtractedText(textParts.join('\n').trim()), SOURCE_CONTEXT_MAX_CHARS);

  return {
    ok: chosen !== 'none' && finalText.length > 0,
    method: chosen,
    title,
    text: finalText,
    links: chosen === 'homepage-links' ? links : links.slice(0, 10),
    diagnostics: {
      htmlLength: html.length,
      candidateMethods,
      fallbackReason: chosen === 'none' ? 'No extractor found usable content.' : undefined,
    },
  };
}
