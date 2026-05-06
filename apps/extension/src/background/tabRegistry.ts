import type { TabRole } from '@lbab/shared';

const WRITER_PATTERNS = [/^https:\/\/x\.com\//, /^https:\/\/twitter\.com\//, /^http:\/\/localhost:4000\/test\/writer/];
const READER_PATTERNS = [/^https:\/\/gemini\.google\.com\//, /^http:\/\/localhost:4000\/test\/llm/];

export function classifyUrl(url: string | undefined): TabRole | null {
  if (!url) return null;
  if (WRITER_PATTERNS.some((re) => re.test(url))) return 'writer';
  if (READER_PATTERNS.some((re) => re.test(url))) return 'reader';
  return null;
}

interface TabInfo {
  tabId: number;
  url: string;
  role: TabRole;
  lastActiveAt: number;
  /**
   * Set true only when the content script has confirmed it is alive
   * via CONTENT_READY or a successful PING_CONTENT round trip. URL
   * matching alone does not mark a tab as ready.
   */
  ready: boolean;
}

class TabRegistry {
  private byTab = new Map<number, TabInfo>();

  /**
   * Add or update a tab as a *candidate* (URL matches a role) without
   * marking it ready. Used by URL-based discovery.
   */
  upsertCandidate(tabId: number, url: string): TabInfo | null {
    const role = classifyUrl(url);
    if (!role) {
      this.remove(tabId);
      return null;
    }
    const existing = this.byTab.get(tabId);
    const info: TabInfo = {
      tabId,
      url,
      role,
      lastActiveAt: existing?.lastActiveAt ?? Date.now(),
      ready: existing?.role === role ? (existing?.ready ?? false) : false,
    };
    this.byTab.set(tabId, info);
    return info;
  }

  /**
   * Mark a tab as ready (content script confirmed). Authoritative source
   * of role and URL — overrides URL-based classification.
   */
  markReady(tabId: number, role: TabRole, url: string): TabInfo {
    const info: TabInfo = { tabId, url, role, lastActiveAt: Date.now(), ready: true };
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

  /**
   * Returns the most recently active *ready* tab for the given role.
   * Tabs that have not sent CONTENT_READY are ignored.
   */
  getMostRecent(role: TabRole): TabInfo | null {
    let best: TabInfo | null = null;
    for (const info of this.byTab.values()) {
      if (info.role !== role || !info.ready) continue;
      if (!best || info.lastActiveAt > best.lastActiveAt) best = info;
    }
    return best;
  }

  list(): TabInfo[] {
    return Array.from(this.byTab.values());
  }

  listReady(): TabInfo[] {
    return Array.from(this.byTab.values()).filter((t) => t.ready);
  }
}

export const tabRegistry = new TabRegistry();
