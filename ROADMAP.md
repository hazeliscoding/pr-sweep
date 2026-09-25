# Roadmap to 1.0

PR Sweep is a desktop PR dashboard (Electron + Angular) for teams that work in sprints across
many repos in one GitHub organization. This file tracks what gets built, in what order, and the
decisions already made.

**The 1.0 promise:** open one lightweight desktop app and see the health of your team's pull
requests for the current sprint, across every repo in the org: what needs attention, why, and
what to do next.

## Decisions (2026-09-25)

- **What needs *us* this sprint, not what needs *me*.** GitHub's pulls dashboard (generally
  available since July 2026) covers the personal inbox: review requests, CI failures, ready to
  merge, saved views. PR Sweep doesn't compete with it there.
- **One attention engine.** Every "this PR has a problem" signal comes from one pure function in
  `desktop/src/main/core/`. The Sweep section, the sprint summary and the standup all read from
  it, and no feature defines its own version.
- **"Run Sweep" is the Sweep section, not a separate workflow.** The app already sweeps every
  5 minutes, so a Run button would only duplicate Refresh.
- **Sprint health and standup ship together.** They read the same data.
- **Workflow health, not human performance.** No per-person counts, leaderboards or review
  stats.
- **No AI before 1.0.** AI comes later, built on the deterministic engine.
- **No "CI stuck" reason.** Check start times are too expensive to fetch per PR.
- **Standup reports current state and what merged since, not transitions.** The app keeps no
  history of state changes.
- **Related-work grouping is in 1.0, in its minimal form:** ticket keys found in titles and
  branch names. Grouping by linked issues comes later. It's the last feature milestone, so it can
  slip to 1.1 without holding up 1.0.
- **Four minor releases to 1.0:** v0.11 Sweep, v0.12 Sprint summary, v0.13 Related work, v0.14
  Release candidate. Fixes ship as patch releases in between.
- **1.0 needs both** the feature milestones done and the auto-updater carrying installed copies
  through each of them. This replaces "1.0 when auto-update has proven itself across a few
  releases". Silent update install only landed in v0.10.3, so it has carried one update so far.
- **macOS is not planned for now.** There's no Mac to build and test on, and no Apple Developer
  Program membership. Gatekeeper blocks unsigned apps and macOS auto-update needs a signed build,
  so shipping unsigned would be worse than not shipping. Revisit if either changes.

## Shipped

Ordering then: distribution first, because every later release gets cheaper once CI ships
builds and the app updates itself; reviewer features and notifications next, because they're
the daily-use value; auth and profiles after, because PAT onboarding worked even if it was
clunky.

### v0.3: Distribution you can trust ✅
- [x] GitHub Actions CI: build + typecheck on every PR
- [x] Release workflow: tagging `v*` builds and attaches the exe automatically
- [x] NSIS installer target alongside portable, wired to electron-updater for self-updates
- [x] Document the SmartScreen warning workaround for the unsigned exe
- [x] Installed app shows as "PR Sweep" in the Start Menu (userData stays at `pr-sweep`)

### v0.4: The reviewer's half of the story ✅
- [x] "My queue" section: open PRs org-wide with your review requested
- [x] Show-drafts toggle
- [x] Stale-PR aging cues (untouched > N days flagged, threshold configurable)

### v0.5: Notifications ✅
- [x] Tray icon with live queue/needs-review counts (alert-badged when your queue is non-empty)
- [x] Desktop toast when a new PR lands in your review queue (click opens the PR)
- [x] Close-to-tray so the app keeps sweeping in the background

### v0.6: Auth without the PAT dance ✅
- [x] GitHub Device Flow OAuth (no token copy/paste, no SSO-blind-PAT trap)
- [x] Personal-access-token sign-in kept as a fallback
- [x] Client ID configurable per-install (Settings) for forks / self-hosters
- [x] Rate-limit backoff for large orgs *(landed in v0.9.2 with the performance work)*

### v0.7: Profiles & shared config ✅
- [x] Multiple org/team profiles with a header switcher
- [x] Profile export/import (JSON) so one person can configure for the whole team
- [x] Auto-migration of pre-v0.7 flat configs into a Default profile

### v0.8: Hardening ✅
- [x] Unit tests for core services (device-flow poll, config migration, query builder + bucketing)
- [x] Tests run in CI on every PR and push
- [x] Keyboard navigation / accessibility pass (focusable PR rows, dialog semantics, focus rings)
- Screenshot driver as a CI smoke test: *moved to v0.14, where a fixture sweep removes the
  token-secret blocker*

### v0.9: Platforms and performance ✅
- [x] Code signing (Azure Trusted Signing in the release workflow, same signing account as ez-money)
- [x] Linux build: AppImage with auto-update, built and published by the release workflow
- [x] Performance for orgs with huge PR volume: auto-refreshes patch the cached sweep
      incrementally (only PRs updated since last time), date windows split automatically
      past GitHub's 1000-result search cap, and rate limits retry with the server-stated wait

### v0.10: Action signals ✅
Theme: the board tells you what actually needs *action*, not just what exists.
- [x] CI status dot on every open PR (latest commit's check rollup: green/red/amber)
- [x] Author-side notifications: toast when your PR is approved, gets changes
      requested, or starts failing CI (reviewer-side queue toasts already existed)
- [x] Review-wait badges in "My queue": how long each PR has been waiting on you,
      flagged past the stale threshold

### v0.10.1–v0.10.4: Update UX and fixes ✅
- [x] Periodic update checks (launch + every 6 hours), so close-to-tray no longer delays
      updates until the next full restart
- [x] In-app header pill with download progress and a Restart button (replaces the
      easily-missed OS toast), plus taskbar progress while downloading
- [x] "Restart to update" in the tray menu, reachable even with the window hidden
- [x] Fetch `statusCheckRollup` and `timelineItems` only in the queries whose rows show them (v0.10.2)
- [x] Updates install silently and relaunch instead of replaying the installer wizard (v0.10.3)
- [x] Single-instance lock: relaunching surfaces the running app instead of a second tray (v0.10.4)

## v0.11: Sweep

Theme: every PR that needs a human shows up once, with the reason and the next step.

- [ ] Snapshot schema version. A sweep never patches a cached snapshot written by an older
      schema. Today the boot refresh patches the cache incrementally, so PRs nobody touched
      would never get new row fields after an update.
- [ ] The open-PR query gains `mergeable`, the last commit's date, and the latest reviews
      (state and time). Measure sweep time on a large org before and after, because v0.10.2
      trimmed fields for a reason.
- [ ] Attention engine: a pure function in `desktop/src/main/core/` with a unit test per
      reason. Each reason carries how long it has held and a next action (Review, Merge,
      Fix CI, Rebase, Nudge).

| Reason | Fires when | Data |
|---|---|---|
| `CI_FAILING` | The latest commit's checks fail | Fetched today |
| `MERGE_CONFLICT` | `mergeable` is `CONFLICTING` (`UNKNOWN` never fires) | New |
| `APPROVED_NOT_MERGED` | Approved, CI passing or absent, for more than a day | New: approval time |
| `CHANGES_NOT_ADDRESSED` | Changes requested and no commit since | New: last commit and review times |
| `NO_REVIEWERS` | Not a draft, no reviews, no pending requests | New: latest reviews |
| `WAITING_FOR_REVIEW` | Needs review past the stale threshold. Uses request time on queue rows, creation time elsewhere | Fetched today |
| `STALE` | No update in `staleDays` | Fetched today |
| `DRAFT_TOO_LONG` | A draft past the stale threshold, when drafts are shown | Fetched today |
| `SPRINT_END_RISK` | Open, not approved, and the range ends within 2 days | Fetched today; needs an end date |

- [ ] "Sweep" section at the top of the board. It lists only PRs with a reason, most severe
      first, one line each with the reason, its age and a next-action link.
- [ ] Decide: a local "snooze until this PR changes" per row. *Recommended: yes, because
      without it the list becomes a static nag.*
- [ ] Decide: whether the tray badge counts Sweep items or keeps counting your review queue.
      *Recommended: keep the queue, because Sweep items are team-wide.*

**Done when:** opening the app shows a short list where every row says why it's there and what
to do, a PR leaves the list on its own once it's fixed, and the first refresh after updating
from v0.10.x fills in every row.

## v0.12: Sprint summary

Theme: the board opens with how the sprint is going, and turns that into a standup in one click.

- [ ] Health strip above the board: merged, open, needs attention, and days left (only when the
      range has an end date).
- [ ] Median time to merge for PRs merged in the range, from `mergedAt − createdAt`. No new
      fields.
- [ ] **Copy standup as Markdown**: merged since the last working day, in review, blocked
      (CI failing, changes requested, conflicts), needs attention.
- [ ] No per-person numbers anywhere.

**Done when:** you can run a standup from the app and paste the summary into Slack or Teams
without editing it.

## v0.13: Related work

Theme: a feature that spans repos reads as one piece of work.

- [ ] Fetch `headRefName` (a cheap scalar field).
- [ ] Group open and merged PRs by a ticket key such as `ABC-123`, found in the title or the
      branch name. PRs without a key render as they do today.
- [ ] Per-profile on/off toggle. It has to survive config migration and profile
      export/import. The key pattern stays built in unless dogfooding needs a custom one.
- [ ] A group shows each PR's state and the group's most severe attention reason.

**Done when:** a feature that spans 3 repos shows as one expandable group with each PR's state.

## v0.14: Release candidate

Theme: nothing new. Make what exists boringly reliable.

- [ ] First-run, empty, loading and error states, checked end to end. That includes the
      SSO-blind token and the pending OAuth-app approval.
- [ ] Fixture sweep: the app can render a canned `SweepResult` without a token.
- [ ] The screenshot driver runs in CI against the fixture sweep (under `xvfb-run`), with no
      token secret needed. This is the item deferred from v0.8.
- [ ] Fresh README screenshots from the fixture sweep.
- [ ] README repositioned around the sprint pitch and the 1.0 promise.
- [ ] Config migration and profile export/import tested with every setting added since v0.11.

**Done when:** a 0.14.x build gets through a full sprint of daily use without needing a fix.

## v1.0: Stable

- [ ] v0.11 through v0.14 each reached installed copies (Windows installer and Linux AppImage)
      through the auto-updater, with no manual reinstall.
- [ ] The 1.0 promise holds.

**Done when:** both boxes are ticked. v1.0.0 adds no features.

## Later

- AI "explain this sprint", built on the attention engine
- Grouping by linked issues (`closingIssuesReferences`) and GitHub Projects
- Review-wait metrics for merged PRs (needs review timestamps on every merged PR, which is
  expensive)
- Roll the date range forward automatically each sprint (a sprint-length setting)
- Post the standup straight to Slack or Teams

## Not planned

- macOS builds, for now (see the decisions above)
- Per-person analytics: review counts, leaderboards, individual cycle times
- A general "all my PRs" inbox. GitHub's pulls dashboard covers it.
