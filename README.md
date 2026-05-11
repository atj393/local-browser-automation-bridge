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
5. Click **Generate next batch now**. Expect *N* items to appear in the
   queue as `pending`, where *N* is the **Posts per generation** value in
   Settings (default 10, range 1–10). The generation panel on the
   dashboard shows the configured count, source mode, and last source URL
   used. The success toast reports *"generated N post(s) · Source: …"*.
6. Click **Post next item now**. The writer textarea should fill with the
   oldest pending item's content, and the queue item moves to `posted`.
7. Open **Settings**, enable **Auto-submit writer** (still pointed at the
   local test page), save.
8. Click **Post next item now** again. The post should appear in the local
   writer's `#feed`.
9. Optional: set min interval = 10 s, max = 20 s, click **Start automation**,
   watch *Next run* update at random intervals, then **Stop automation**.

---

## Content sources (RSS / web pages)

Each generation can use one source URL as context for Gemini, so the
posts are based on real material instead of a generic topic. Sources are
configured in the dashboard's **Settings → Content sources** section.

- **Source URLs** — one URL per line. RSS / Atom feeds are detected
  automatically; everything else is fetched as a normal web page and
  reduced to title + meta description + headings + paragraphs.
- **Source mode**
  - **Rotate sources** *(default)* — each *Generate next batch now*
    advances to the next URL, looping at the end.
  - **Use first source only** — always uses the first URL in the list.
  - **No source / prompt only** — sends the prompt without external
    context.
- **Posts per generation** — integer **1 to 10**, default 10. Backend
  caps any over-generation by Gemini at this number.

Safety:

- Only `http://` and `https://` URLs are accepted.
- Localhost / private IPs (`10.x`, `172.16-31.x`, `192.168.x`, `127.x`,
  `0.0.0.0`, `::1`) are **rejected** to avoid SSRF.
- Each fetch has a 10 s timeout, 1 MB cap, and the resulting context is
  trimmed to ~6 k characters.
- If a fetch fails, the backend logs a warning and continues with the
  prompt-only fallback — generation does *not* fail.

The prompt can use placeholders, which the backend replaces before
sending to Gemini:

| Placeholder              | Replaced with                                         |
|--------------------------|-------------------------------------------------------|
| `{{postsPerGeneration}}` | The configured number of posts (also `{{batchSize}}`).|
| `{{sourceUrl}}`          | The selected source URL, or `(none)`.                 |
| `{{sourceContext}}`      | Extracted RSS items or web page text.                 |
| `{{date}}`               | Today's date in `YYYY-MM-DD`.                         |

If your custom prompt doesn't include any placeholders, the backend
appends a context block automatically.

---

## Categories and content sources

The app organizes sources into **categories** (e.g. *General News*, *Tech
News*) and treats them as the unit of variety when posting.

- **Default categories** seeded on first run: *General News* and *Tech
  News*. You can rename, recolor, disable, or add more in
  *Settings → Categories*.
- **Every content source** has a URL + (optional) label + category +
  enabled flag. Use the row editor in *Settings → Content sources* to add
  / edit / remove sources.
- **Every generated queue item inherits the category** of the source it
  came from. You can see the badge in the dashboard's Posting Timeline
  and on the Queue page.
- The legacy `source_urls` textarea is automatically migrated on first
  run: each URL is split, a heuristic picks *Tech News* (for URLs
  containing words like `tech`, `ai`, `github`, `developer`, `engineering`,
  …) or *General News* otherwise, and rows are inserted into
  `content_sources`. The original column is preserved for back-compat.

## Queue posting strategy

The *Queue posting strategy* control in *Settings* picks how the next
post is chosen from the queue:

- **Rotate categories** *(default)* — if more than one category is
  pending, the next post will **not** be from the same category as the
  previous post. If only one category is pending, posting continues from
  that category.
- **Oldest first** — posts strictly in queue order regardless of
  category.

Example, with last posted = *General News* and queue:

```
General News  A1
General News  A2
Tech News     B1
Tech News     B2
```

*Rotate categories* will pick `B1` next, then `A1`, then `B2`, then `A2`.
With only one category left, it keeps posting from that category.

The scheduler also uses this order to assign `scheduled_for` times, so
the dashboard's *Upcoming* table reflects the category-rotated sequence.

## Source URL extraction

Each generation can attach one source URL as context for Gemini. The
backend tries several extractors in order and uses the first one that
returns usable content:

1. **RSS / Atom feed** — when the response is `application/rss+xml` /
   `application/atom+xml` or the body starts with `<rss>` / `<feed>`.
   Latest 8 items are summarized as title + link + date + description.
2. **JSON-LD** — `<script type="application/ld+json">` blocks for
   `NewsArticle`, `Article`, `BlogPosting`, `WebPage`, `ItemList`. The
   `headline` / `description` / `articleBody` fields are pulled out.
3. **Mozilla Readability** — best for article URLs. Skipped if the
   extracted body is shorter than ~400 chars.
4. **OpenGraph + meta** — `og:title`, `og:description`, `twitter:*`,
   `<meta name="description">`, `<title>`. Always usable as a baseline.
5. **Cheerio body** — `h1` / `h2` / `h3` / `<p>` / `<li>` text inside
   `article` / `main` / `[role="main"]` / `.content` / `.post` /
   `.story` / `.news` / `.article` containers (with a `<body>` fallback).
6. **Homepage-link fallback** — when the page is a news index, the
   extractor returns the top 30 same-origin headline links so Gemini can
   write posts based on themes and headlines (it is told not to invent
   facts beyond what is provided).

Tips:

- For best results, point at an **article URL** or an **RSS feed URL**.
- Homepage URLs work via the link-fallback when nothing better is found.
- Some sites block automated fetches or render content via JavaScript;
  no extraction method works in those cases. The prompt cleanly falls
  back to its built-in topic, and a warning is logged.
- Tamil / non-English text is preserved as-is.
- Browser-rendered fetch (e.g., Playwright) is not enabled — keeping the
  prototype lightweight.

### Test source extraction

Use the *Test source extraction* control on the **Settings** page (or
`POST /api/sources/test` with `{ "url": "..." }`) to debug a URL before
adding it. The response includes the chosen extraction method, the
extracted length, the resolved final URL after redirects, the
content-type, and a 200-character preview.

If extraction fails:

| Problem | Suggested fix |
|---|---|
| *No usable content extracted* | Try an article URL instead of the homepage. |
| *No usable content extracted* | Try the site's RSS feed URL if available (often `/feed`, `/rss`, `/atom.xml`). |
| HTTP 4xx or 5xx | The site may block scraping; pick a different source. |
| Page is JavaScript-rendered | Browser-rendered fetch is not enabled by default; pick a server-rendered URL. |
| Times out | The site is slow or blocking; the 10 s timeout fired. |
| URL rejected as private | Localhost / private-network URLs are blocked for SSRF safety. |

---

## Understanding the queue and posting timeline

When you click *Generate next batch now*, items are added to the queue and
shown on the **Queue** page. They sit there until automation runs.

When you click *Start automation*:

1. The backend assigns each pending item a **`scheduledFor`** time using the
   randomized interval. The first item is scheduled at
   `now + random(min, max)`; each subsequent item is scheduled at
   `previous.scheduledFor + random(min, max)`.
2. The dashboard's **Posting Timeline** panel shows:
   - Automation status badge (Running / Paused / Posting / Stopped)
   - The next post's content, scheduled time, and a live countdown
   - The configured random interval (e.g. *1–4 minutes*)
   - The **Upcoming** table — the next ten scheduled items with their
     scheduled times and live countdowns
   - A plain-English `automationMessage` (e.g. *"Automation is running.
     Next post is scheduled in 02:43."*)

When you click *Stop automation*:

- The internal timer is cleared.
- `scheduledFor` values are kept for transparency, but the dashboard says
  *"Schedule is paused. Click Start automation to refresh and continue."*
- No posts will fire while stopped.

When you click *Start automation* again, the schedule is **recomputed** for
all unposted items from `now`, so countdowns are fresh.

When a new batch is generated while automation is running, the new items
are **appended** to the existing schedule starting from the latest pending
`scheduledFor` (so previously-scheduled items are not disturbed).

When you change the min/max interval in *Settings* while automation is
running, the schedule for all unposted items is **recalculated**. This is
also logged. If you change the interval while automation is **stopped**,
any stale `scheduledFor` values from the previous interval are
**cleared** so the dashboard does not display ghost countdowns; fresh
times are computed when you click *Start automation* again.

### Batch automation vs posting automation

There are now **two independent loops** running when automation is on:

- **Posting interval** controls the spacing between individual X posts.
  Lives on the post scheduler. Each pending queue item gets a
  `scheduledFor` timestamp `previous + random(min, max)`.
- **Batch interval** controls when Gemini is asked to create a *new
  batch* — only after the queue becomes empty. Lives on the batch
  scheduler. By default it waits `random(batchMin, batchMax)` before
  calling Gemini.

Example flow:

```
Settings:
  Posts per generation:  5
  Post interval:         1–4 minutes
  Batch interval:        15–30 minutes
  Refill mode:           Wait a random delay when queue is empty

1. You click Generate next batch now → 5 items queued.
2. Start automation.
3. Posting fills the X composer every 1–4 minutes.
4. After the 5th item posts, the queue is empty.
5. Batch scheduler arms a timer for 15–30 minutes from now.
6. Dashboard shows "Queue is empty. Next batch will be generated in 22:14."
7. Timer fires → Gemini generates the next batch → posting resumes.
```

**Refill modes**

- *Wait a random delay when queue is empty* (default) — the safe behavior:
  the app waits a random delay (within the batch interval) before asking
  Gemini for a new batch.
- *Generate immediately when queue is empty* — calls Gemini as soon as
  the queue empties. Useful for tight demos; not recommended for
  long-running automation.

**Manual override**

The *Generate next batch now* button always bypasses the batch timer
(but it still respects the in-memory single-flight lock and refuses if
the reader is disconnected). When the queue already has items, this
button still queues an additional batch on top — your post schedule is
preserved.

**Backend restart behavior**

In-memory timers are lost on backend restart. The startup hook resets
`is_batch_generation_running = 0` and `next_batch_run_at = NULL` so the
dashboard does not show a fake countdown after a crash. Click *Start
automation* again to resume.

### Posting interval

In *Settings → Posting interval*, set the minimum and maximum delay using
**number + unit** controls (seconds / minutes / hours). The backend stores
the values as seconds internally; the dashboard handles the conversion.

- **Default**: 1–4 minutes (the *Normal* preset).
- **Minimum allowed**: 10 seconds.
- **Maximum allowed**: 24 hours.
- **Maximum must be ≥ minimum.**

Quick presets are provided:

| Preset | Range |
|---|---|
| Testing | 10–20 seconds |
| Demo | 30–60 seconds |
| Normal *(default)* | 1–4 minutes |
| Slow | 10–30 minutes |
| Reset to default | 1–4 minutes |

The dashboard shows a friendly range label (e.g. *"1–4 minutes"* or, for
awkward values, *"1h 23m 20s – 2h 30m"*) and a warning banner when the
maximum is shorter than 60 s (testing-only) or longer than 1 hour (next
post may be far in the future). If you ever see a wildly long countdown,
it almost certainly means a previous value was entered as raw seconds:
open *Settings*, click *Reset to default*, and save.

If `Auto-submit writer` is **off** (the safe default), the extension fills
the X composer at each scheduled time and stops; you manually click *Post*
in X. The queue item is marked `posted` once filling succeeds.

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

This is the recommended live workflow.

1. Open `https://x.com/home`. Log in.
2. Confirm Settings → *Auto-submit writer* is **off** (the safe default).
3. On the dashboard, click **Post next item now**.
4. Switch to the X tab; the compose box should be filled with the next
   queued post (including hashtags, if your prompt asked for them).
5. **You** review the content and click *Post* in X if you want it
   published. The backend logs the action as `filled into writer (no
   submit)` and marks the queue item `posted` so the queue advances.
6. Repeat as needed.

The user always remains in control. Auto-submit exists for the local
test page; using it against real X is at your own discretion and risk.

---

## Manual posting fallback

X actively protects its composer against automated input. When the
extension's automated insertion is rejected (no `span[data-text="true"]`
produced, post button never enables, etc.), the extension does **not**
keep retrying. Instead it switches to a *manual-paste* mode:

1. The post content is copied to the clipboard from the X tab if Chrome
   allows it.
2. A small visible overlay appears on X with step-by-step instructions:
   *Click inside the X composer → Press Ctrl+V → Review → Click Post*.
3. The queue item is moved to the new **`needs_manual_post`** status —
   not `failed`, so it stays clearly actionable in the dashboard.
4. The dashboard's *Queue* table renders a yellow *Manual required*
   badge on those rows with three actions:
   - *Copy* — re-copies the content from the dashboard (no permission
     needed).
   - *Mark as posted* — once you've pasted and posted manually, click
     this; the item flips to `posted` and the queue advances.
   - *Retry* — flips it back to `pending` so the next *Post next item
     now* / scheduler tick will try the automated path again.

The extension never bypasses or attempts to defeat X's anti-automation
guards. We mirror exactly what a human would do (focus → paste → post).

## Production option: X API

Browser DOM automation is a prototype-only path. For reliable production
posting:

- Use the **official X API** (v2) with OAuth 2.0 PKCE.
- The endpoints `POST /2/tweets` and the matching scopes (`tweet.write`,
  `users.read`, `tweet.read`) cover the same functionality without
  needing a logged-in browser tab.
- Server-side posting also avoids per-tab focus, anti-automation
  surprises, and the "manual paste fallback" workflow above.

This repository intentionally does not ship an X API integration. The
manual fallback exists so that local demos still complete cleanly when
DOM automation is rejected, not as a substitute for the real API.

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
| Gemini generated JSON but the queue is empty | The response wasn't parseable JSON or every item was rejected by post validation. Check backend logs for `Could not parse Gemini response as JSON` (with raw preview) or `No valid posts after cleaning`. |
| X composer is filled but nothing was posted | **Expected** when *Auto-submit writer* is off (the safe default). Switch to the X tab, review the content, and click *Post* manually. |
| Source URL fetch failed | Backend logs a warning (`Source fetch failed; falling back to prompt-only`) and continues generation without external context. Check the URL in your browser. |
| Source URL was rejected | Localhost / private-network URLs are blocked to prevent SSRF. Use a public URL. |
| Reader / Writer disconnected after some time, even though the extension is connected | See *Reader/Writer disconnected after some time* below. The extension now self-heals via a heartbeat and backend rediscovery; in most cases the dashboard recovers without refreshing the tab. |

### Reader/Writer disconnected after some time

Chrome Manifest V3 service workers can sleep, and the extension's in-memory tab registry disappears with them. To recover automatically, the extension now uses:

- **Content-script heartbeat** — `geminiReader.ts` / `xWriter.ts` send `CONTENT_READY` on load and again every 30 seconds, plus on `focus`, `visibilitychange`, `pageshow`, and SPA URL changes.
- **Background rediscovery** — when the service worker wakes (`onStartup`, `onInstalled`, WebSocket opens, backend re-registers, `chrome.alarms` heartbeat, focus changes, command routing), it queries tabs matching reader/writer URL patterns, sends `PING_CONTENT`, and re-announces ready tabs to the backend.
- **Backend `REDISCOVER_TABS`** — on backend restart, when the extension re-registers, the backend tells the extension to rescan. Backend tab state has a 90 s TTL; stale tabs are shown as *Stale* in the dashboard while rediscovery runs.
- **Safe re-injection** — when ping fails on a matching tab, the background tries `chrome.scripting.executeScript` once (requires the `scripting` permission, added to manifest).
- **Dashboard readiness states** — Reader/Writer cards now show `Ready` / `Stale` / `Not responding` / `Disconnected` with an inline hint.

If, despite all of that, the dashboard still says *Not responding* or *Disconnected*:

1. Click the reload icon for the extension at `chrome://extensions`. (After reloading the extension, content scripts in already-open tabs lose their Chrome runtime context and **do** need a one-time page refresh — this is a Chrome MV3 limitation, not an app bug.)
2. Refresh the reader/writer tab.
3. Open the extension service-worker console and look for `[lbab/background] rediscovering content tabs:` log lines.
4. Open the reader/writer page console and look for `heartbeat CONTENT_READY sent`.

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
