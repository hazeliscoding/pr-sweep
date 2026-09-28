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
- **Brand** keeps the existing mark: a gold main branch and a blue feature branch merging, on a
  navy tile. It gains a wordmark in Manrope ExtraBold, converted to vector paths, taken from the
  lockup layout of logo design 1b. Design 1b's own mark was considered and dropped. The assets are
  in `docs/brand/`, with `-dark` files for dark backgrounds.

## Decisions (2026-09-26)

- **No Tauri rewrite before 1.0.** Sweep time is GitHub's, not the app's: after warm-up, the
  app's own CPU is 77–173 ms of a 7–8 s team sweep (1–2%), so a Rust client can't make sweeps
  meaningfully faster. What Tauri would change is installer size and idle memory, which
  haven't been measured yet.

## Decisions (2026-09-28)

- **Every release has hand-written notes** in `docs/releases/vX.Y.Z.md`: a bold TL;DR line, then
  short one-line bullets under New, Faster, Fixed, Heads up and Getting it. The release workflow
  publishes the file as the release body and fails before building if it's missing. GitHub's
  generated notes were just a compare link.

## v0.11 decisions (2026-09-25)

- **The board shows all of the team's open PRs**, not only the ones updated in the range, so PRs
  carried over from an earlier sprint appear. Merged stays "merged in range".
- **The Sweep covers team PRs only.** Your review queue keeps its own section.
- **The engine runs in main after every sweep, over every row.** Incremental refreshes keep
  untouched rows cached for days, so reasons saved once on a row would freeze.
- **Cost was measured before choosing.** A read-only probe ran the v0.10.4 queries and each new
  field against the electron org (30-day range, median of 5 runs, with the app's retry policy):

| Query | Team profile (5 authors) |
|---|---|
| Open, v0.10.4 | 3.9 s, 29 rows |
| Open + free fields (`id`, request count, team slugs, commit date) | 4.1 s |
| Open + `latestReviews` | 4.0 s |
| Open + `mergeable` | 4.7 s (+21%) |
| Carried over (open, updated before the range) | 1.9 s, 6 rows |
| Detail query, approved + changes-requested rows | 0.6 s, 13 rows |
| Merged, v0.10.4 | 51 s, 357 rows in 4 sequential pages |
| Queue, v0.10.4 | 0.7 s |

  Runs of the same query varied by about ±20%, so small differences are noise. For the whole org
  with no authors set, every open query failed with 502 on every attempt, including v0.10.4's.
- **Expensive fields go in a detail query.** `mergeable` and `latestReviews` are fetched with
  `nodes(ids:)` only for approved, changes-requested and unrequested needs-review rows. It runs
  while the much slower merged search is still in flight, so it adds no wall time.
- **v0.11 also fixes two performance problems from v0.10.4:** the merged search fetches its pages
  one at a time, and whole-org views of big orgs fail with 502.
- **Budget:** the full sweep on the electron team profile is no slower than v0.10.4, auto-refresh
  time is unchanged, and the electron whole-org view completes.
- **Baseline** (v0.10.4, `e2e/bench-sweep.mjs`, electron, last 30 days, 5 runs): the team
  profile's full sweep takes 28.9 s median (25.1–38.3 s, 6–7 requests) and its auto-refresh 0.7 s
  (1 request). The whole-org view failed with 502 in 5 of 5 runs, after 49–96 s. Auto-refresh
  time depends on org activity: when anything in the org changed since the last sweep, the
  refresh runs three more searches (4 requests, about 2 s). Compare auto-refreshes with the same
  request count.
- **Whole-org views on big orgs stay slow for v0.11:** about 110 s after the page-size fallback,
  170 s once carried-over PRs joined the board. Their time goes to 60 s waits
  on GitHub's secondary rate limit (403 with Retry-After). The waits track the number of search
  requests: the team profile (8–9 requests per sweep) almost never hits one, and whole-org
  (30–70) always does. Remembering shrunken page sizes across searches was tried and reverted,
  because smaller pages meant more requests (172 s median instead of 109 s).
- **`NEEDS_RE_REVIEW` is a reason of its own.** "Changes requested" has two next steps: the
  author's (address the feedback) and the reviewer's (re-review after the push).
- **Sprint-end risk is a header line, not a row reason.** As a reason it would flag nearly every
  unapproved PR in the last two days, when the list should be shortest.
- **Quiet rows keep the Sweep short** (decided 2026-09-27). A flagged row goes quiet when its
  worst reason is a slow one (waiting, stale, old draft) or nobody has touched the PR in 30+
  days. Quiet rows sit behind "Show quiet", muted, and the tray count leaves them out. On the
  electron team profile the Sweep went from 25 rows to 13. Built after a live sweep showed 25
  of 32 open PRs flagged, with abandoned PRs burying the ones someone would act on this sprint.
- **Drafts only get `DRAFT_TOO_LONG`.** There are no new settings: fixed thresholds are
  constants, and the slow ones use the profile's `staleDays`.
- **Snooze** hides a row until the PR updates, gains a more severe reason, or the next day comes.
  It's stored per machine in `localStorage` and never exported. It has no unit test, because the
  renderer has no test harness; it's checked by hand.
- **The tray badge keeps counting your review queue.** The menu gains a team attention line.
  There are no new notifications.
- **Each roadmap release is built on its own branch** (`release/vX.Y`) and reaches `main`
  through a pull request.

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

Theme: every PR that needs a human shows up once, with the reason and the next step. Built on
the `release/v0.11` branch.

- [x] Sweep timing line under `PRSWEEP_DEBUG`: full or auto, duration, searches and retries.
      Record the v0.10.4 baseline with it on the electron team and whole-org profiles, 5 full and
      5 auto refreshes each, taking the median.
- [x] Snapshot schema version (`schema: 2`). `SnapshotStore.get` returns null for an older
      schema and a sweep never patches one, so the first refresh after an update is a full one.
- [x] Merged search in weekly windows, fetched in parallel with at most 4 in flight. Each window
      still splits itself past 1000 results. *Measured: the team profile's full sweep dropped to
      10.8 s median (9.7–13.4 s, plus one 69.9 s run that hit a retry), from 28.9 s.*
- [x] Page-size fallback: a search page that fails with 502 or 504, or arrives as a 200 with a
      cut-off body, is re-sent at 50, then 25, before the normal retries. Re-sending the same
      request first would only add backoff: those are timeouts on queries too heavy to answer.
      *Measured: the team profile's full sweep takes 8.9 s median, and the whole-org view
      completes in 5 of 5 runs (109 s median, 93–173 s). Most of that time is 60 s waits on
      GitHub's secondary rate limit (403 with Retry-After), 4–9 per whole-org sweep.*
- [x] Data, then measure against the budget:
  - the open search gains `id`, `reviewRequests.totalCount`, team slugs and the last commit's
    `committedDate`. Review requests to teams now count, and the "Awaiting" column shows them.
  - a carried-over search (`updated:<rangeStart`, same fields) runs in parallel with it.
  - a detail query (`nodes(ids:)`, up to 100 per call) fetches `mergeable` and `latestReviews`
    for approved, changes-requested and unrequested needs-review rows. It starts as soon as both
    open searches land.
  - new `PrRow` fields: `mergeable`, `lastCommitAt`, `approvedAt`, `changesRequestedAt`,
    `reviewCount` and `requestCount` (schema 3). `attention` arrives with the engine.

  *Measured: the team profile's full sweep takes 9.1 s median (10 requests) and its quiet
  auto-refresh 0.6 s, both within budget. A live sweep filled details on exactly the 27 rows that
  need them and found 6 merge conflicts. The whole-org view still completes in 5 of 5 runs, but
  at 170 s median: its carried-over PRs add search requests, and with them more rate-limit
  waits.*
- [x] Attention engine: `desktop/src/main/core/attention.ts`, a pure function with a test for each
      reason at its boundary. `prs:fetch` runs it over the open rows after every sweep, full or
      incremental. It also returns `sprintRisk`. Editing `staleDays` triggers a refresh (an
      incremental one, so it's usually a single request). Schema 4. *On a live electron team
      sweep, with drafts shown, 31 of 39 open PRs got a reason: 6 CI failures, 4 conflicts,
      6 old drafts, and many long-lived PRs that are also stale.*

| # | Reason | Fires when | `since` | Next step |
|---|---|---|---|---|
| 1 | `CI_FAILING` | CI is failing | last commit | Fix CI (`/checks`) |
| 2 | `MERGE_CONFLICT` | details say `CONFLICTING` (`UNKNOWN` never fires) | none | Resolve conflict |
| 3 | `CHANGES_NOT_ADDRESSED` | changes requested, no commit since, for more than a day | the review | Address feedback |
| 4 | `NEEDS_RE_REVIEW` | changes requested, a commit since, no re-review for more than a day | the commit | Re-review (`/files`) |
| 5 | `APPROVED_NOT_MERGED` | approved, CI passing or absent, no conflict, for more than a day | the approval | Merge |
| 6 | `NO_REVIEWERS` | needs review, no requests to people or teams, no reviews, open more than an hour | opened | Request reviewers |
| 7 | `WAITING_FOR_REVIEW` | needs review, has requests, open longer than `staleDays` | opened | Nudge reviewers |
| 8 | `STALE` | no update in `staleDays` | last update | Nudge |
| 9 | `DRAFT_TOO_LONG` | a draft older than `staleDays`, when drafts are shown | opened | Ready or close |

  Drafts only ever get reason 9, and `staleDays = 0` turns off reasons 7–9. The list is ordered
  by most severe reason, then longest-standing first.

- [x] Sweep section at the top of the board: PR, CI, title (a link), why (the most severe reason
      and its age, plus chips for the others), author, next step and snooze. Rows aren't clickable
      as a whole. Author chips and the text filter apply. When the range ends within 2 days, the
      header says how many open PRs aren't approved yet. Empty state: "Nothing needs attention."
- [x] Snooze per row, plus "Show snoozed" to reveal and unsnooze. *Checked through the built
      app: hiding, surviving a relaunch, reveal and unsnooze, and each way a snooze ends (the PR
      changes, a worse reason, a new day).*
- [x] Quiet rows: `isQuiet` in the engine, `quiet` on each row (schema 5), and a "Show quiet"
      toggle. The tray count leaves them out.
- [x] Tray: a "N need attention (team)" menu line and tooltip fallback, with `attentionCount`
      added to `syncTray`. Settings: the stale-threshold help text mentions the Sweep.
- [x] `chore(release): v0.11.0` with its notes in `docs/releases/v0.11.0.md`, then mark the pull
      request ready, merge it, and tag `v0.11.0`.
- [ ] Update an installed v0.10.4 through the auto-updater and check that the first refresh fills
      every row without a manual Refresh.

**Done when:** opening the app shows a short list where every row says why it's there and what
to do, a PR leaves the list on its own once it's fixed, the first refresh after updating from
v0.10.x fills in every row, and the budget holds with the numbers recorded here.

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

- Faster whole-org views on very large orgs: pace searches under GitHub's secondary rate
  limit instead of waiting out 403s
- Tauri port, decided after 1.0 from measured idle memory and installer size. A port means
  rewriting the main process in Rust, moving to Tauri's updater through a bridge release, and
  every user signing in again (Electron `safeStorage` tokens can't be read). If memory matters
  sooner, a cheaper first step: move the refresh loop into the main process and close the
  window, instead of hiding it, when the app goes to the tray.
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
