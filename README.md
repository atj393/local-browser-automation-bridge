# Local Browser Automation Bridge

A local prototype that connects two independent browser websites using a
Chrome extension, a local backend, a dashboard, a SQLite queue, and a
WebSocket bridge — without modifying either website.

The reference flow uses **Gemini** as the LLM source ("reader") and
**X (Twitter)** as the posting target ("writer"), but it works against any
two pages by adjusting selectors. Local test pages are bundled so the whole
demo runs offline without touching real services.

---

## ⚠️ Safety note

This repository is a **local proof-of-concept**, not a production posting
or scraping product.

- **Auto-submit is disabled by default.** The writer content script fills
  the compose field and stops. You manually click *Post*.
- For real websites such as X.com, keep auto-submit off and review every
  generated post before sending.
- Use this only with **accounts and pages you own or have permission to
  test against**.
- Do **not** use this for spam, fake engagement, scraping abuse,
  rate-limit evasion, or to bypass any platform's terms of service.
- Selectors and DOM probing exist for resilience against minor UI changes.
  Production integrations should use official APIs instead.

---

## Architecture

```
Dashboard  ─HTTP─▶  Backend
                    ├─ SQLite queue
                    ├─ Scheduler (random interval)
                    └─ WebSocket gateway  ◀─WS─▶  Chrome extension
                                                   ├─ background SW
                                                   ├─ reader content script (Gemini / local LLM)
                                                   └─ writer content script (X / local writer)
```

One Chrome extension, two content scripts. The backend is the brain; the
dashboard is the control panel; the extension is the in-browser agent.

---

## What is included

```
local-browser-automation-bridge/
├── apps/
│   ├── backend/      Express + node:sqlite + WebSocket gateway + scheduler
│   ├── dashboard/    React + Vite control panel (status, settings, queue, logs)
│   └── extension/    Manifest V3 Chrome extension (CRXJS)
└── packages/
    └── shared/       Shared types, contracts, constants
```

The backend also serves two **local test pages** that emulate the real
reader/writer DOMs so you can run the demo without ever opening Gemini or X:

- `http://localhost:4000/test/llm` — emulates Gemini, replies with valid
  10-item JSON one second after Send.
- `http://localhost:4000/test/writer` — emulates an X composer + feed.

---

## Tech stack

- **pnpm** workspace (monorepo)
- **TypeScript** end-to-end
- **Node.js** + **Express** for the backend
- **`node:sqlite`** (built-in, no native compilation) for the queue
- **`ws`** for the WebSocket gateway
- **React** + **Vite** for the dashboard
- **Chrome Manifest V3** + **`@crxjs/vite-plugin`** for the extension
- **Zod** for input validation

---

## Requirements

- **Node.js 22.5+ recommended; 24.x verified.** The backend uses Node's
  built-in `node:sqlite`, which is stable in Node 24 and gated behind
  `--experimental-sqlite` on Node 22.5–22.x. An `ExperimentalWarning` may
  print on boot — harmless.
- **pnpm 9+**.
- **Google Chrome / Chromium** (any recent version with MV3 support).
- **Localhost only.** The backend binds to `127.0.0.1:4000`. No remote
  configuration needed.

---

## Install

```bash
pnpm install
```

## Run development

Three terminals (or `pnpm dev` to run all in parallel):

```bash
pnpm dev:backend      # http://localhost:4000
pnpm dev:dashboard    # http://localhost:5173
pnpm dev:extension    # builds to apps/extension/dist (watch mode)
```

## Load the Chrome extension

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Select `apps/extension/dist`.

> After rebuilding the extension, click the **reload** icon on the extension
> in `chrome://extensions` and **refresh** any open reader/writer tabs so
> their content scripts pick up the new build.

---

## Local demo (verified, no Gemini or X required)

1. Start backend, dashboard, and extension watch (above).
2. Load the unpacked extension from `apps/extension/dist`.
3. Open three tabs:
   - `http://localhost:5173` — the dashboard.
   - `http://localhost:4000/test/llm` — the reader test page.
   - `http://localhost:4000/test/writer` — the writer test page.
4. On the dashboard's **Demo readiness checklist**, confirm green badges for:
   - **Extension: Connected**
   - **Reader tab: Connected**
   - **Writer tab: Connected**
   - (See *Troubleshooting* below if any of these stay red.)
5. Click **Generate next batch now**. Expect 10 items to appear in the queue
   as `pending`.
6. Click **Post next item now**. The writer textarea should fill with the
   oldest pending item's content, and the queue item moves to `posted`.
7. Open **Settings**, enable **Auto-submit writer** (still pointed at the
   local test page), save.
8. Click **Post next item now** again. The post should appear in the local
   writer's `#feed`.
9. Optional: set min interval = 10 s, max = 20 s, click **Start automation**,
   watch *Next run* update at random intervals, then **Stop automation**.

---

## Real website demo

> Keep **auto-submit disabled** for X. Manually review every post before
> clicking *Post*.

### Reader (Gemini)

1. Open any Gemini chat URL, e.g. `https://gemini.google.com/app`.
2. Make sure you're logged in.
3. On the dashboard, click **Generate next batch now**. The extension types
   the prompt into Gemini and waits for the response to stabilize.
4. The backend extracts JSON and queues the items.

If selectors miss, edit
[`apps/extension/src/shared/selectors.ts`](apps/extension/src/shared/selectors.ts).

### Writer (X)

1. Open `https://x.com/home`. Log in.
2. With auto-submit **off**, click **Post next item now**.
3. Switch to the X tab; the compose box should be filled.
4. Manually review the content and click *Post* if (and only if) you intend to.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **`Could not establish connection. Receiving end does not exist.`** | The background service worker could not reach the content script. Reload the extension at `chrome://extensions` (reload icon), then refresh the reader/writer tabs. The page console must show `content script loaded` → `message listener registered` → `CONTENT_READY sent`. The extension service-worker console must show `[lbab/background] CONTENT_READY received`. |
| Extension not connected | Backend must be running. Reload the extension. |
| Writer / Reader tab not connected | Open `http://localhost:4000/test/writer` (or `https://x.com/home`) / `http://localhost:4000/test/llm` (or your Gemini URL) and **refresh** the page. |
| `Generate next batch now` button disabled | Reader tab must be connected (see above). The button's tooltip explains the missing precondition. |
| `Post next item now` button disabled | Writer tab must be connected and the queue must have at least one pending item. |
| Generate batch fails | Open the reader tab DevTools console; look for `[lbab/gemini-reader]` logs. Backend logs show the raw response preview. |
| X does not fill composer | X DOM may have changed; inspect with DevTools and update `X_COMPOSER_SELECTORS`. |
| Gemini response not parsed | Your prompt must yield JSON. The backend logs the raw response preview when extraction fails. |
| Backend says *Running* but nothing happens after restart | The startup hook resets `is_running=false` and `next_run_at=null` automatically. Click *Start automation* again. |
| Items stuck in `posting` after a crash | The startup hook resets them to `pending` with an explanatory error message. |

### Expected console logs

**Reader tab page console (DevTools → Console):**

```
[lbab/gemini-reader] content script loaded http://localhost:4000/test/llm
[lbab/gemini-reader] message listener registered http://localhost:4000/test/llm
[lbab/gemini-reader] CONTENT_READY sent {ok: true, ackedBy: 'background', tabId: …}
```

**Writer tab page console:**

```
[lbab/x-writer] content script loaded http://localhost:4000/test/writer
[lbab/x-writer] message listener registered http://localhost:4000/test/writer
[lbab/x-writer] CONTENT_READY sent {ok: true, ackedBy: 'background', tabId: …}
```

**Extension service-worker console** (`chrome://extensions` → *Service worker*):

```
[lbab/background] CONTENT_READY received reader <tabId> http://localhost:4000/test/llm
[lbab/background] CONTENT_READY received writer <tabId> http://localhost:4000/test/writer
```

---

## API summary (backend)

| Method | Path | Description |
|---|---|---|
| GET    | `/api/status`            | Counts, connection state, last log. |
| GET    | `/api/settings`          | Current automation settings. |
| PUT    | `/api/settings`          | Update settings (Zod-validated). |
| POST   | `/api/automation/start`  | Start scheduler. |
| POST   | `/api/automation/stop`   | Stop scheduler, clear timer. |
| POST   | `/api/batches/generate`  | Force one Gemini batch generation. |
| POST   | `/api/posts/post-next`   | Post oldest pending item now. |
| GET    | `/api/posts`             | List queue items (filter by `status`). |
| POST   | `/api/posts/:id/retry`   | Move a failed/skipped item back to pending. |
| POST   | `/api/posts/:id/skip`    | Mark item as skipped. |
| POST   | `/api/posts/:id/post-now`| Force an immediate post for one item. |
| DELETE | `/api/posts`             | Clear queue (optionally by `?status=`). |
| GET    | `/api/logs`              | Recent log entries. |
| DELETE | `/api/logs`              | Clear logs. |
| GET    | `/test/writer`           | Local writer test page. |
| GET    | `/test/llm`              | Local LLM test page. |

WebSocket: `ws://localhost:4000/ws`. The extension is the only client.
Round-trips are matched by `requestId`. Timeouts: 150 s for Gemini batches,
30 s for writer fills.

---

## Development commands

```bash
pnpm typecheck         # TypeScript across all 4 workspace packages
pnpm build             # Build all
pnpm build:backend     # tsc --noEmit (backend runs via tsx)
pnpm build:dashboard   # tsc --noEmit + vite build
pnpm build:extension   # vite build (CRXJS) → apps/extension/dist
```

---

## Repository status

- **Built outputs** (`dist/`, `apps/*/dist/`) are generated and **not
  committed**.
- **Runtime data** (`apps/backend/data/*.sqlite*`) is generated and **not
  committed**. The directory is preserved via `.gitkeep`.
- `node_modules/` is **not committed**.
- `pnpm-lock.yaml` **is** committed for reproducible installs.

---

## Known limitations

- Real websites can change DOM selectors; `selectors.ts` is the single
  source of truth for all DOM probes.
- The extension only acts on tabs that are currently open.
- The scheduler is single-process and in-memory; backend restart resets it.
- The dashboard polls (`/api/status` every 2 s); no dashboard WebSocket yet.
- No authentication on the local backend (binds to localhost only).
- `node:sqlite` prints an `ExperimentalWarning` on boot — harmless.
- Icons are 1×1 placeholder PNGs.
- Not production-ready. For production, use the platform's official API.

---

## Implementation notes

How the pieces fit together:

- **Manifest V3 background service worker** declared via
  `defineManifest` from `@crxjs/vite-plugin`. Vite + TypeScript build
  outputs an unpacked extension to `apps/extension/dist`.
- **Two content scripts**, one per role: a *reader* matching the LLM
  pages and a *writer* matching the posting pages. Each is guarded by
  a `window.__loaded__` flag to survive duplicate injection.
- **`CONTENT_READY` handshake.** When a content script loads, it
  registers its `chrome.runtime.onMessage` listener *before* anything
  async, then notifies the background service worker. Only after this
  handshake is a tab considered "ready" in the background's tab registry.
- **`PING_CONTENT` liveness check.** Before dispatching a heavy
  command, the background round-trips a synchronous ping to confirm
  the content script's listener is still attached. This avoids the
  classic `Receiving end does not exist` failure mode.
- **WebSocket bridge** between the extension's background SW and the
  local backend. Messages are matched by `requestId` with explicit
  per-type timeouts (150 s for batch generation, 30 s for writes).
- **Local SQLite queue** (via Node's built-in `node:sqlite`) holds the
  generated post items, their statuses, and an append-only log table.
  Stale runtime fields (`is_running`, `next_run_at`, `posting` rows)
  are reset on backend startup.
- **Dashboard-driven control flow.** All actions originate from the
  React dashboard; the scheduler in the backend is single-process and
  in-memory; the extension is a passive executor.
- **Reliable input insertion.** Native value setter for
  `<textarea>` / `<input>`, plus `execCommand('insertText')` +
  `InputEvent` dispatch for `contenteditable` elements, with a
  `textContent` fallback. This makes framework-controlled inputs
  (React, Vue, etc.) actually fire their `input`/`change` handlers.
- **Selector fallbacks.** Each role has an ordered list of
  selectors; specific matches are tried first, broad fallbacks
  (`main`, `body`) are used only when nothing else returns text and a
  warning is logged when they do.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: install, run, branch
naming, `pnpm typecheck` before opening a PR, and respect the safety rules
above.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

[MIT](LICENSE).
