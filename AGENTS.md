# AGENTS.md

These are the working rules for agents in this repo. PR Sweep is a desktop PR dashboard
(Electron + Angular, MIT) for teams that work in sprints across many repos in one GitHub
organization. It ships for Windows and Linux.

## Sources of truth

- `README.md`: the pitch, features, setup, and the GitHub search quirks the app encodes.
- `ROADMAP.md`: decisions already made, the milestones, and what is out of scope. Check it
  before proposing features. Respect those decisions unless the owner reopens them.
- Work from the next unchecked item in `ROADMAP.md`. Tick it off when it's done, and record new
  decisions there under a dated heading. Don't build past the current milestone without asking.
- Don't create spec docs, backlogs or project boards unless asked.

## Layout

- `desktop/src/main/`: Electron main process. `core/` holds plain services with no Electron
  imports, so they run in plain Node tests.
- `desktop/src/shared/types.ts` is the whole main↔renderer contract.
  `desktop/renderer/src/app/models.ts` is a hand-kept mirror, because the renderer can't import
  across the boundary. A contract change touches `types.ts`, `models.ts`, `preload.ts` and
  `ipc.ts`.
- `desktop/renderer/`: the Angular app. `BoardStore` (signals) holds the board state.
- `desktop/e2e/screenshot.mjs`: drives the built app with playwright-core for visual checks.

## GitHub API rules

- Search uses the `ISSUE_ADVANCED` backend, the only one where `(author:a OR author:b)` works.
  The search string goes in as a GraphQL variable, so logins never need escaping.
- Buckets come from `reviewDecision`, never from labels or `review:` qualifiers. A null
  `reviewDecision` means nobody approved, so it buckets as needs review.
- Search returns at most 1000 results per query. Date-windowed queries go through
  `searchWindowed`, which splits the window until each half fits.
- Datetime qualifiers want `+00:00`, not `Z`.
- A token that isn't SSO-authorized for the org gets empty results, not errors. `orgVisible` is
  the only reliable probe.
- `statusCheckRollup` and `timelineItems` dominate sweep latency. Request an expensive field only
  in the query whose rows display it (`QUERY_BARE`, `QUERY_OPEN`, `QUERY_QUEUE`). Measure sweep
  time on a large org before and after adding fields.
- A field only some rows need (`mergeable`, review times) goes in `DETAIL_QUERY`, fetched with
  `nodes(ids:)` for just those rows, never in a search. Details are optional: if that query
  fails, the sweep still succeeds and those fields stay null.
- Verify API behavior against the live API before encoding it. Record each verified quirk in the
  header comment of `github.service.ts` and in the README.

## Cached data and config

- The boot refresh and auto-refreshes patch `snapshot.json` incrementally, so a PR nobody touched
  on GitHub keeps its cached row. When `PrRow` or `SweepResult` changes shape, bump
  `SWEEP_SCHEMA` in `desktop/src/shared/types.ts`. Snapshots from another schema are then
  never painted or patched, and the first refresh after an update is a full one.
- `ConfigService` migrates `config.json` on read (`normalizeProfile`). A new setting needs a
  default there, must survive profile export/import, and needs a case in
  `config.service.test.mjs`.
- Profile export never includes tokens or machine-level preferences.
- Sweep snoozes live in the renderer's `localStorage` (`prsweep-snoozes`), per machine, next to
  the theme choice. They're never exported, and entries from earlier days are pruned.
- Tokens are encrypted at rest with Electron `safeStorage` in `token.bin`. Never log a full
  token.
- Don't rename the userData folder (`app.setName('pr-sweep')`) or the executable
  (`pr-sweep.exe`). Renaming the first orphans existing installs' config. Azure Trusted Signing
  fails on spaces in the executable path.

## Product rules

- The attention engine (`desktop/src/main/core/attention.ts`) is the single definition of
  "needs attention". `prs:fetch` runs it over every open row after every sweep, cached rows
  included. The Sweep section, the tray line and the sprint summary read its output; the
  renderer never decides on its own whether a PR needs attention.
- Workflow health, not human performance: no per-person counts, leaderboards or review stats.
- No AI features before 1.0.
- Windows and Linux only. macOS is not planned.

## Brand

- The assets are in `docs/brand/`. `mark.svg` is the source of the app icon. `lockup.svg` is for
  light backgrounds and `lockup-dark.svg` for dark ones.
- The mark: a gold (`#d1a249`) main branch and a blue (`#98c6ff`) feature branch merging, on a
  navy (`#001740`) tile. These are the app's light primary, gold and dark accent.
- The wordmark is Manrope ExtraBold (800) with -0.02em tracking, converted to vector paths. It is
  navy `#001740` on light and white on dark. Use the SVGs; don't re-typeset it with a web font.
- `desktop/build/icon.png` (512px) is rendered from `docs/brand/mark.svg`. `tray.png` and
  `tray-alert.png` (256px) are the same mark, and the alert one adds a red badge. Re-render the
  PNGs whenever the mark changes.

## Commands

Run these from the repo root unless noted.

- `npm install && npm run setup` installs root, desktop and renderer dependencies.
- `npm run dev` runs the Angular dev server on :4301 and Electron with live reload.
- `npm run build` runs the renderer AOT build and the main-process `tsc`. Together they are the
  typecheck.
- `npm test` runs the Node tests in `desktop/src/main/core/*.test.mjs`. They import the compiled
  `desktop/dist/`, so build first.
- `npm run package:win` builds the installer and portable exe. `npm run package:linux` builds
  the AppImage and has to run on Linux. Local packages are unsigned unless the Azure env vars
  are set.
- From `desktop/` after `npm run build`, `node e2e/screenshot.mjs --fixtures [busy,calm,…]`
  shoots every fixture state in both themes to `desktop/e2e/shots/`, with no token or network.
  `GH_TOKEN=$(gh auth token) PRSWEEP_ORG=<org> node e2e/screenshot.mjs` shoots the live board.
  Every run uses a throwaway `--user-data-dir` and aborts unless the app really uses it; never
  point a UI script at the real data folder (Chromium ignores `%APPDATA%` overrides).
- `PRSWEEP_FIXTURE=<name>` makes an unpackaged build serve canned sweeps from
  `desktop/e2e/fixtures/<name>.json` instead of GitHub, still judged by the real attention
  engine. Fixture times are relative (`"-3d"`, `"+2d"`); rows list only what matters and the
  loader (`core/fixture.ts`) fills the rest. `busy` must keep triggering all nine attention
  reasons (its test checks).
- `PRSWEEP_DEBUG=1` makes the main process log GraphQL variables and response bodies, plus one
  `[sweep]` line per sweep with its mode, duration, requests and retries.
- From `desktop/` after `npm run build:main`,
  `GH_TOKEN=$(gh auth token) node e2e/bench-sweep.mjs <org> [login,login,…] [runs]` times full
  sweeps and auto-refreshes against the live API. The performance budget in `ROADMAP.md` is
  measured with it.

## Releases

- The app version lives in `desktop/package.json`. The root `package.json` version isn't used.
- **Each roadmap release gets its own branch**, `release/vX.Y`, cut from `main`. All of that
  milestone's commits go there. Open a draft pull request to `main` early, so CI runs on every
  push, and keep its testing steps current. When the milestone's "Done when" holds, mark it
  ready, merge, then tag `vX.Y.0` on `main`.
- A roadmap release bumps the version once, in the last commit on its branch:
  `chore(release): v0.11.0`. A patch outside a milestone bumps it in the fix commit and ends the
  subject with it: `fix: single-instance lock … (v0.10.4)`.
- **Every release has hand-written notes** in `docs/releases/vX.Y.Z.md`, committed with the
  version bump. The release workflow publishes that file as the release body and fails before
  building if it's missing. Write them for a reader skimming on a phone:
  - Open with one bold **TL;DR:** line saying what changed and why it matters.
  - Then short sections, in this order, only when they have something: `## New`,
    `## Faster`, `## Fixed`, `## Heads up` (anything a user might trip over), and
    `## Getting it`.
  - One line per bullet, starting with a **bold** phrase. Plain words, user-visible effects,
    real numbers when there are some. No commit hashes, no internals, no paragraphs, and no
    emoji: Quorum's voice applies to release notes too.
- Pushing a `v*` tag runs `.github/workflows/release.yml`. It builds the signed Windows installer,
  the portable exe and the Linux AppImage, then publishes one GitHub release. The `latest*.yml`
  files and blockmaps must ship with every release, because the auto-updater reads them.
- Only tag or push when the owner asks.

## Working style

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `perf:`, `docs:`, `chore:`, `test:`, `ci:`, `build:`, `refactor:`). Keep each commit atomic,
  and use a scope when it adds clarity (`docs(roadmap): …`).
- **No AI attribution** in commits or PRs. That means no `Co-Authored-By` trailers, no
  "Generated with" lines and no session links.
- **Tests:** logic in `core/` gets a Node test next to it with a mocked GitHub endpoint, never
  the network. Add a case for every attention reason and every config migration.
- **Code comments:** match the surrounding density. Comments explain why: an API quirk, a
  performance trade-off, a fallback and its cause. Don't restate what the code says.
- **Docs:** short. Prefer editing `ROADMAP.md` over new planning documents.
- Local Playwright MCP output goes to `.playwright-mcp/`, which git ignores.
