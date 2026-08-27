# Roadmap to 1.0

Ordering logic: distribution first, because every later release gets cheaper once CI ships
builds and the app updates itself; reviewer features and notifications next, because they're
the daily-use value; auth and profiles after, because PAT onboarding works today even if
it's clunky.

## v0.3 — Distribution you can trust
- [ ] GitHub Actions CI: build + typecheck on every PR
- [ ] Release workflow: tagging `v*` builds and attaches the exe automatically
- [ ] NSIS installer target alongside portable, wired to electron-updater for self-updates
- [ ] Document the SmartScreen warning workaround for the unsigned exe

## v0.4 — The reviewer's half of the story
- [ ] "My queue" view (`review-requested:@me`)
- [ ] Show-drafts toggle
- [ ] Stale-PR aging cues (untouched > N days gets flagged)

## v0.5 — Notifications
- [ ] Tray icon with a needs-review badge count
- [ ] Toast when something new lands in your queue

## v0.6 — Auth without the PAT dance
- [ ] GitHub Device Flow OAuth (no token copy/paste, no SSO-blind-PAT trap)
- [ ] Rate-limit backoff for large orgs

## v0.7 — Profiles & shared config
- [ ] Multiple org/team profiles with a quick switcher
- [ ] Config export/import so one person can configure for the whole team

## v0.8 — Hardening
- [ ] Unit tests for core services (config migration, review bucketing, query builder)
- [ ] Screenshot driver running as a smoke test in CI
- [ ] Keyboard navigation / accessibility pass

## v0.9 → 1.0 — Polish and platforms
- [ ] macOS / Linux builds
- [ ] Performance for orgs with huge PR volume (caching, smarter pagination)
- [ ] Code signing
- [ ] 1.0 when auto-update has proven itself across a few releases
