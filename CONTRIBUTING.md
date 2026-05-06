# Contributing

Thanks for your interest. This is a small prototype, so contributions should
stay focused: bug fixes, selector updates, docs improvements, and minor UX
polish are all welcome. Please don't open large refactors or new product
features without discussing first.

## Quick start

```bash
pnpm install
pnpm dev:backend       # http://localhost:4000
pnpm dev:dashboard     # http://localhost:5173
pnpm dev:extension     # builds to apps/extension/dist (watch)
```

Load the unpacked extension from `apps/extension/dist` via
`chrome://extensions` → *Developer mode* → *Load unpacked*.

## Branching

- Branch from `main`.
- Use short, descriptive names: `fix/x-composer-selector`,
  `docs/troubleshooting`, `feat/dashboard-disabled-states`.
- One logical change per branch.

## Before opening a PR

1. `pnpm typecheck` — must pass.
2. `pnpm build` — must succeed.
3. Run the local demo end-to-end (load extension, open both test pages,
   *Generate next batch now*, *Post next item now*) and confirm it still
   works.
4. If you changed any DOM probing, update
   [`apps/extension/src/shared/selectors.ts`](apps/extension/src/shared/selectors.ts)
   and call out the change in the PR description.
5. Keep commits focused and reasonably small.

## Safety rules (hard requirements)

The following changes will be rejected:

- Anything that flips **`autoSubmitWriter`** to `true` by default.
- Anything that hides automation activity from the user (no auto-clicking
  through interstitials, no muting console logs, no disabling dashboard
  visibility).
- Anything that targets credential capture, session theft, captcha bypass,
  rate-limit evasion, or anti-bot defeat.
- Any feature designed for mass-posting, fake engagement, or scraping
  abuse against platforms you don't control.

This project is a local proof-of-concept for browser-to-browser workflow
integration on test accounts and pages you own. Keep it that way.

## Code style

- TypeScript everywhere; `strict` is on.
- Prefer small, composable functions.
- Don't add comments that just describe what the code does — keep them for
  non-obvious *why*.
- No new dependencies unless they replace something painful. Discuss first.

## Reporting bugs

Open a GitHub issue with:

- What you ran (`pnpm dev:backend`, etc.).
- What you saw vs. expected.
- Page console + extension service-worker console excerpts (the
  `[lbab/...]` log lines are most useful).
- Backend log excerpts from `/api/logs`.
