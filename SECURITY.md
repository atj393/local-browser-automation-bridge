# Security policy

## Reporting a vulnerability

If you discover a security issue in this project, please report it through
**GitHub's private vulnerability reporting** (Security → *Report a
vulnerability* on the repository page) or by opening a regular issue if the
problem is low-impact and already public knowledge.

Please do **not** disclose details publicly until a fix is available.

A useful report includes:

- Affected file(s) and version (commit hash).
- Steps to reproduce.
- Impact (data exposure, RCE, privilege escalation, etc.).
- Any suggested mitigation.

## Scope

In scope:

- The local backend at `apps/backend/`.
- The dashboard at `apps/dashboard/`.
- The Chrome extension at `apps/extension/`.
- Anything that ships in `packages/shared/`.

Out of scope:

- **Requests to add or restore platform-evasion features.** This project
  intentionally does not implement captcha bypass, anti-bot defeat,
  credential capture, rate-limit evasion, or anything similar. Such
  reports will be closed.
- The DOM of third-party services (Gemini, X). If a DOM change breaks the
  extension, that's a normal selector update, not a security report —
  open a regular issue.
- Issues in dependencies that have already been disclosed upstream;
  please link to the upstream advisory instead.

## Secrets

The repository is designed to **not store any secrets**:

- The backend has no API keys, no auth tokens, no remote credentials.
- All state lives locally in `apps/backend/data/bridge.sqlite` (gitignored).
- The Chrome extension has no API keys baked in.

If you find a leaked secret in the repository history, please report it.
