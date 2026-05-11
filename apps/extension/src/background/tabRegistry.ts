import type { TabRole } from '@lbab/shared';
import { CONTENT_READY_TTL_MS } from '@lbab/shared';

const WRITER_PATTERNS = [/^https:\/\/x\.com\//, /^https:\/\/twitter\.com\//, /^http:\/\/localhost:4000\/test\/writer/];
const READER_PATTERNS = [/^https:\/\/gemini\.google\.com\//, /^http:\/\/localhost:4000\/test\/llm/];

export function classifyUrl(url: string | undefined): TabRole | null {
  if (!url) return null;
  if (WRITER_PATTERNS.some((re) => re.test(url))) return 'writer';
  if (READER_PATTERNS.some((re) => re.test(url))) return 'reader';
  return null;
}

export const WRITER_TAB_QUERY: chrome.tabs.QueryInfo[] = [
  { url: 'https://x.com/*' },
  { url: 'https://twitter.com/*' },
  { url: 'http://localhost:4000/test/writer*' },
];

export const READER_TAB_QUERY: chrome.tabs.QueryInfo[] = [
  { url: 'https://gemini.google.com/*' },
  { url: 'http://localhost:4000/test/llm*' },
];

export interface TabInfo {
  tabId: number;
  url: string;
  role: TabRole;
  /** True once URL matches a role pattern. */
  urlMatched: boolean;
  /** True once a CONTENT_READY or successful PING_CONTENT round-trip happened. */
  contentScriptReady: boolean;
  /** Last time CONTENT_READY arrived from this tab. */
  lastReadyAt: number | null;
  /** Last time we pinged this tab. */
  lastPingAt: number | null;
  /** Result of the last ping. */
  lastPingOk: boolean;
  lastError: string | null;
  lastActiveAt: number;
  /** Back-compat alias for code that still checks `.ready`. */
  ready: boolean;
}

class TabRegistry {
  private byTab = new Map<number, TabInfo>();

  private mk(tabId: number, role: TabRole, url: string): TabInfo {
    const now = Date.now();
    return {
      tabId,
      role,
      url,
      urlMatched: true,
      contentScriptReady: false,
      lastReadyAt: null,
      lastPingAt: null,
      lastPingOk: false,
      lastError: null,
      lastActiveAt: now,
      ready: false,
    };
  }

  /**
   * Add or update a tab as a *candidate* (URL matches a role) without
   * marking it ready.
   */
  upsertCandidate(tabId: number, url: string): TabInfo | null {
    const role = classifyUrl(url);
    if (!role) {
      this.remove(tabId);
      return null;
    }
    const existing = this.byTab.get(tabId);
    if (existing && existing.role === role) {
      existing.url = url;
      existing.urlMatched = true;
      existing.lastActiveAt = Date.now();
      return existing;
    }
    const info = this.mk(tabId, role, url);
    this.byTab.set(tabId, info);
    return info;
  }

  /**
   * Mark a tab ready (content script confirmed). Authoritative source
   * of role and URL — overrides URL-based classification.
   */
  markReady(tabId: number, role: TabRole, url: string): TabInfo {
    const now = Date.now();
    const existing = this.byTab.get(tabId);
    const info: TabInfo = existing
      ? { ...existing, role, url }
      : this.mk(tabId, role, url);
    info.urlMatched = true;
    info.contentScriptReady = true;
    info.ready = true;
    info.lastReadyAt = now;
    info.lastActiveAt = now;
    info.lastError = null;
    this.byTab.set(tabId, info);
    return info;
  }

  markPingSuccess(tabId: number, role: TabRole, url: string): TabInfo {
    const now = Date.now();
    const existing = this.byTab.get(tabId);
    const info: TabInfo = existing
      ? { ...existing, role, url }
      : this.mk(tabId, role, url);
    info.urlMatched = true;
    info.contentScriptReady = true;
    info.ready = true;
    info.lastPingAt = now;
    info.lastPingOk = true;
    info.lastReadyAt = now;
    info.lastActiveAt = now;
    info.lastError = null;
    this.byTab.set(tabId, info);
    return info;
  }

  markPingFailure(tabId: number, role: TabRole, url: string, error: string): TabInfo {
    const now = Date.now();
    const existing = this.byTab.get(tabId);
    const info: TabInfo = existing
      ? { ...existing, role, url }
      : this.mk(tabId, role, url);
    info.urlMatched = true;
    info.contentScriptReady = false;
    info.ready = false;
    info.lastPingAt = now;
    info.lastPingOk = false;
    info.lastError = error;
    this.byTab.set(tabId, info);
    return info;
  }

  remove(tabId: number): TabInfo | null {
    const existing = this.byTab.get(tabId);
    if (existing) this.byTab.delete(tabId);
    return existing ?? null;
  }

  touch(tabId: number): void {
    const info = this.byTab.get(tabId);
    if (info) info.lastActiveAt = Date.now();
  }

  private isFresh(info: TabInfo): boolean {
    if (!info.contentScriptReady) return false;
    if (info.lastReadyAt == null) return false;
    return Date.now() - info.lastReadyAt < CONTENT_READY_TTL_MS;
  }

  /**
   * Returns the most recently ready tab for the given role, regardless
   * of staleness. Caller is expected to ping if it cares about liveness.
   */
  getMostRecent(role: TabRole): TabInfo | null {
    let best: TabInfo | null = null;
    for (const info of this.byTab.values()) {
      if (info.role !== role || !info.contentScriptReady) continue;
      if (!best || info.lastActiveAt > best.lastActiveAt) best = info;
    }
    return best;
  }

  /**
   * Most recent ready tab whose heartbeat is still inside the TTL.
   */
  getMostRecentFresh(role: TabRole): TabInfo | null {
    let best: TabInfo | null = null;
    for (const info of this.byTab.values()) {
      if (info.role !== role || !this.isFresh(info)) continue;
      if (!best || info.lastActiveAt > best.lastActiveAt) best = info;
    }
    return best;
  }

  list(): TabInfo[] {
    return Array.from(this.byTab.values());
  }

  listReady(): TabInfo[] {
    return Array.from(this.byTab.values()).filter((t) => t.contentScriptReady);
  }

  listCandidates(role?: TabRole): TabInfo[] {
    return Array.from(this.byTab.values()).filter(
      (t) => t.urlMatched && (!role || t.role === role),
    );
  }

  /** Snapshot for debugging / logging. */
  snapshot(): Array<Pick<TabInfo, 'tabId' | 'role' | 'url' | 'contentScriptReady' | 'lastReadyAt' | 'lastPingOk' | 'lastError'>> {
    return Array.from(this.byTab.values()).map((t) => ({
      tabId: t.tabId,
      role: t.role,
      url: t.url,
      contentScriptReady: t.contentScriptReady,
      lastReadyAt: t.lastReadyAt,
      lastPingOk: t.lastPingOk,
      lastError: t.lastError,
    }));
  }
}

export const tabRegistry = new TabRegistry();
