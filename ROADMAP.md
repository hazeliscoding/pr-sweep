# Roadmap to 1.0

Ordering logic: distribution first, because every later release gets cheaper once CI ships
builds and the app updates itself; reviewer features and notifications next, because they're
the daily-use value; auth and profiles after, because PAT onboarding works today even if
it's clunky.

## v0.3 — Distribution you can trust ✅
- [x] GitHub Actions CI: build + typecheck on every PR
- [x] Release workflow: tagging `v*` builds and attaches the exe automatically
- [x] NSIS installer target alongside portable, wired to electron-updater for self-updates
- [x] Document the SmartScreen warning workaround for the unsigned exe
- [x] Installed app shows as "PR Sweep" in the Start Menu (userData stays at `pr-sweep`)

## v0.4 — The reviewer's half of the story ✅
- [x] "My queue" section — open PRs org-wide with your review requested
- [x] Show-drafts toggle
- [x] Stale-PR aging cues (untouched > N days flagged, threshold configurable)

## v0.5 — Notifications ✅
- [x] Tray icon with live queue/needs-review counts (alert-badged when your queue is non-empty)
- [x] Desktop toast when a new PR lands in your review queue (click opens the PR)
- [x] Close-to-tray so the app keeps sweeping in the background

## v0.6 — Auth without the PAT dance ✅
- [x] GitHub Device Flow OAuth (no token copy/paste, no SSO-blind-PAT trap)
- [x] Personal-access-token sign-in kept as a fallback
- [x] Client ID configurable per-install (Settings) for forks / self-hosters
- [ ] Rate-limit backoff for large orgs *(deferred to a later release)*

## v0.7 — Profiles & shared config ✅
- [x] Multiple org/team profiles with a header switcher
- [x] Profile export/import (JSON) so one person can configure for the whole team
- [x] Auto-migration of pre-v0.7 flat configs into a Default profile

## v0.8 — Hardening ✅
- [x] Unit tests for core services (device-flow poll, config migration, query builder + bucketing)
- [x] Tests run in CI on every PR and push
- [x] Keyboard navigation / accessibility pass (focusable PR rows, dialog semantics, focus rings)
- [ ] Screenshot driver as a CI smoke test *(deferred — needs a headed runner + token secret)*

## v0.9 → 1.0 — Polish and platforms
- [ ] macOS / Linux builds
- [ ] Performance for orgs with huge PR volume (caching, smarter pagination)
- [ ] Code signing
- [ ] 1.0 when auto-update has proven itself across a few releases
