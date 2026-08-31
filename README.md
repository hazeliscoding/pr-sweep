<p align="center"><img src="desktop/build/icon.svg" width="120" alt="PR Sweep logo"></p>

<h1 align="center">PR Sweep</h1>

A portable desktop PR dashboard for teams that work in sprints across many repos in one
GitHub organization. One window that answers: **what's open, what needs review, what has
changes requested, what's approved, and what merged — this sprint.**

![board — light theme](docs/screenshots/board.png)
![board — dark theme](docs/screenshots/board-dark.png)

## ✨ Features

- 📋 **Status board** — dense tables for Needs review · Changes requested · Approved · Merged,
  bucketed from GitHub's actual `reviewDecision`. No labels, no manual bookkeeping.
- 🙋 **My queue** — a section for open PRs anywhere in the org with *your* review requested,
  so nothing waiting on you slips through — each row shows how long it's been waiting on you,
  flagged when it passes the stale threshold.
- 🚦 **CI status** — every open PR shows its latest commit's check rollup as a
  green/red/amber dot, so "approved" and "actually ready to merge" stop being confused.
- ⏳ **Stale flags** — open PRs untouched past a configurable threshold are highlighted; toggle
  draft PRs on or off.
- 📅 **Date-range scoped** — pick From/To dates in the header and they persist; leave "To" empty
  for an open-ended view. Set the range at sprint start and forget about it.
- 👥 **Team-scoped** — aggregate PRs authored by a configurable list of GitHub logins
  (leave the list empty to see the whole org), with per-author filter chips and free-text search.
- 🗂️ **Profiles** — save multiple org/team/date-range views and switch between them from the
  header. **Export/import** profiles as a JSON file so one person configures the team's view
  and everyone else imports it (tokens are never included).
- ⚡ **Instant boot** — the last sweep is cached to disk and shown immediately on launch,
  then refreshed quietly in the background.
- 🔗 **Click a row** → PR opens in your browser.
- 🔔 **Tray + notifications** — lives in the system tray with live counts and desktop toasts
  for both directions of the loop: a PR lands in your review queue, or one of *your* PRs gets
  approved, gets changes requested, or starts failing CI (click a toast to open the PR).
  Closing the window keeps it running in the tray so it keeps watching.
- 🔄 Auto-refresh (default every 5 min), manual Refresh button.
- 🌗 Light/dark theme toggle; follows the OS on first run, choice persists per machine.
- 🔑 **Sign in with GitHub** (device flow) — no token to copy-paste; personal-access-token
  sign-in stays as a fallback.
- 🔐 Credentials stored encrypted at rest (Windows DPAPI via Electron safeStorage) — they never
  leave the machine.

## 🚀 Getting started

Grab a build from [Releases](../../releases):

- **Windows** — the **setup exe** installs PR Sweep (Start Menu entry, self-updating on new
  releases); the **portable exe** just runs with no install (but doesn't self-update).
- **Linux** — the **AppImage** runs on any distro (`chmod +x pr-sweep-*.AppImage`, then run
  it) and self-updates on new releases. Your token is encrypted via the system keyring
  (GNOME Keyring / KWallet via libsecret) when one is available; without one it falls back
  to base64 obfuscation — prefer a keyring on shared machines.
- **macOS** — not yet; see the [roadmap](ROADMAP.md).

Or build it yourself (below).

> **SmartScreen note:** builds are code-signed (Azure Trusted Signing) as of v0.9. If
> SmartScreen still warns while the certificate builds reputation, click *More info → Run
> anyway*. Builds you compile yourself are unsigned unless you configure your own signing.

First launch asks for your GitHub organization, then offers two ways to connect:

- **Sign in with GitHub** (recommended) — enter a short code at `github.com/login/device`;
  no token to manage.
- **Personal access token** — a classic token with `repo` + `read:org` scopes. If your org
  uses SAML SSO, **Configure SSO** on the token and authorize the org (an unauthorized token
  gets no API errors, just silently empty results — PR Sweep detects and explains this rather
  than showing an empty board).

Then add your team's GitHub logins in Settings and set the date range in the header.

> **Private orgs & "Sign in with GitHub":** the first time someone signs in for a private
> org that restricts third-party OAuth apps, GitHub shows a **"request access to `<org>`"**
> prompt after they authorize — this is expected, not an error. An **org owner approves the
> app once** (org **Settings → Third-party access → OAuth app access policy**), and from then
> on every teammate can sign in normally. Until it's approved, the board will look empty even
> though sign-in "succeeded"; that's the pending approval, not a bug. Public orgs need no
> approval.

### Self-hosting the OAuth sign-in

"Sign in with GitHub" needs a registered OAuth App's client ID. The public builds ship one; if
you fork this, register your own (GitHub → Developer settings → **New OAuth App**, then enable
**Device Flow**) and either set `DEFAULT_OAUTH_CLIENT_ID` in
`desktop/src/main/core/oauth.constants.ts` before building, or paste it into **Settings → OAuth
App client ID** at runtime. The client ID is public by design (device flow has no secret).

## 🛠️ Development

```
npm install          # root orchestration deps
npm run setup        # desktop + renderer deps
npm run dev          # Angular dev server (:4301) + Electron with live reload
```

## 📦 Packaging

```
npm run package:win    # builds renderer + main, emits desktop/release/pr-sweep-*-setup.exe + portable exe
npm run package:linux  # same, emits desktop/release/pr-sweep-*.AppImage (build on Linux)
```

Release builds are signed via **Azure Trusted Signing** (`desktop/package.json` →
`build.win.azureSignOptions`; account `ezmoney-signing`, profile `EZMoneyCert` — shared
with ez-money). CI authenticates with a service principal through the `AZURE_TENANT_ID`,
`AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` repo secrets; local packaging skips signing
unless those env vars are set.

## 🏗️ Architecture

```
desktop/
  src/main/           Electron main: window + IPC registration
    core/             plain services (no Electron imports where possible)
      config.service  org/authors/range/refresh persisted to userData/config.json
      token.store     PAT encrypted at rest via safeStorage (userData/token.bin)
      snapshot.store  last sweep cached to userData/snapshot.json for instant boot
      github.service  GraphQL search (ISSUE_ADVANCED backend), reviewDecision bucketing,
                      rate-limit backoff, cap-splitting windowed pagination, incremental refresh
  src/preload/        typed window.api bridge (contextIsolation on)
  src/shared/types.ts the whole main<->renderer contract
  renderer/           Angular app: BoardStore (signals) + board/settings pages
  e2e/screenshot.mjs  playwright-core drive script for visual checks
```

GitHub search quirks this encodes (verified against the live API):

- Multiple bare `author:` qualifiers AND together and match nothing; OR needs the
  advanced search backend (`type: ISSUE_ADVANCED` in GraphQL) and parentheses:
  `(author:a OR author:b)`.
- The advanced backend spells `review:changes_requested` with an underscore
  (legacy search uses a hyphen). PR Sweep buckets from `reviewDecision` instead.
- A null `reviewDecision` (repo without required-review branch protection) still
  means nobody approved — it buckets as *needs review*.
- A token that isn't SSO-authorized for an org gets no search errors — results are
  just silently filtered. The only reliable probe is whether the org's repositories
  are visible at all.
- Search hard-caps every query at 1000 results no matter how you paginate. When a
  busy range would blow past it, PR Sweep splits the date window in half and queries
  the halves recursively. Auto-refreshes skip most of this entirely: they ask only
  for PRs updated since the previous sweep and patch the cached result (a manual
  Refresh always resweeps in full).

## 🗺️ Roadmap

See [ROADMAP.md](ROADMAP.md) for the path to 1.0.

## 📄 License

[MIT](LICENSE)
