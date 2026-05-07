import type {
  AutomationSettings,
  PostQueueItem,
  AutomationLog,
  StatusResponse,
  UpdateSettingsBody,
  PostStatus,
} from './types.js';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const errMsg =
      (data && typeof data === 'object' && 'error' in data && (data as { error: unknown }).error) ||
      `Request failed: ${res.status}`;
    throw new Error(String(errMsg));
  }
  return data as T;
}

export const api = {
  getStatus: () => request<StatusResponse>('GET', '/api/status'),
  getSettings: () => request<AutomationSettings>('GET', '/api/settings'),
  updateSettings: (body: UpdateSettingsBody) =>
    request<AutomationSettings>('PUT', '/api/settings', body),
  startAutomation: () =>
    request<{ ok: boolean; settings: AutomationSettings }>('POST', '/api/automation/start'),
  stopAutomation: () =>
    request<{ ok: boolean; settings: AutomationSettings }>('POST', '/api/automation/stop'),
  generateBatch: () =>
    request<{ ok: boolean; inserted: number; batchId: string; sourceUrl: string | null }>(
      'POST',
      '/api/batches/generate',
    ),
  postNext: () =>
    request<{ ok: boolean; postId?: number; resultStatus?: string; autoSubmitted?: boolean }>(
      'POST',
      '/api/posts/post-next',
    ),
  listPosts: (status?: PostStatus, limit = 200) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('limit', String(limit));
    return request<{ items: PostQueueItem[] }>('GET', `/api/posts?${qs.toString()}`);
  },
  retryPost: (id: number) =>
    request<{ ok: boolean; item: PostQueueItem }>('POST', `/api/posts/${id}/retry`),
  skipPost: (id: number) =>
    request<{ ok: boolean; item: PostQueueItem }>('POST', `/api/posts/${id}/skip`),
  markPosted: (id: number) =>
    request<{ ok: boolean; item: PostQueueItem }>('POST', `/api/posts/${id}/mark-posted`),
  postNow: (id: number) =>
    request<{ ok: boolean; postId?: number; resultStatus?: string }>(
      'POST',
      `/api/posts/${id}/post-now`,
    ),
  clearQueue: (status?: PostStatus) => {
    const qs = status ? `?status=${status}` : '';
    return request<{ ok: boolean; removed: number }>('DELETE', `/api/posts${qs}`);
  },
  getLogs: (limit = 200) =>
    request<{ items: AutomationLog[] }>('GET', `/api/logs?limit=${limit}`),
  clearLogs: () => request<{ ok: boolean }>('DELETE', '/api/logs'),
  testSource: (url: string) =>
    request<{
      ok: boolean;
      url?: string | null;
      finalUrl?: string | null;
      method?: string;
      contentType?: string;
      status?: number;
      size?: number;
      title?: string | null;
      extractedLength?: number;
      preview?: string;
      error?: string;
    }>('POST', '/api/sources/test', { url }),
};
