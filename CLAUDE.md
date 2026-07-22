# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**neisme Calendar** — Electron 33 desktop widget that overlays a translucent 5-week calendar on the desktop and syncs against Google Calendar, Google Tasks, and NextCloud (CalDAV). Comments and UI strings are in Korean; keep that style when editing existing code.

## Commands

```bash
npm start                # run app (Electron)
npm run dev              # run with --dev (DevTools auto-opens, F12/Ctrl+Shift+I toggles)
npm run build:win        # NSIS .exe → dist/
npm run build:mac-universal   # Universal .dmg
npm run build:mac-arm    # Apple Silicon only
npm run build:mac-intel  # Intel only
```

There is no test runner, linter, or formatter configured — don't fabricate one.

`google-config.json` (OAuth client_id/client_secret) is required for Google features and is gitignored. CI restores it from `secrets.GOOGLE_CONFIG_JSON` or falls back to a dummy. Node 22+.

### Releases
Pushing a `v*` tag triggers `.github/workflows/build-{mac,win}.yml`, which builds and attaches artifacts to a GitHub Release automatically. `package.json` `version` must be bumped first, and commit message + tag must use the same version.

**Versioning is date-based (as of v26.7.22): `vYY.M.D` from the release date, no zero padding** — work released on 2026-07-22 is `v26.7.22`. A *second* release on the same day appends a letter that grows alphabetically: `v26.7.22a`, then `v26.7.22b`, … The first release of the next day resets to plain `v26.7.23`. Never carry the previous day's number forward — always re-derive from today's date. (Versions before v26.6.7 used an unrelated sequential scheme; don't extrapolate from them.)

- `package.json` version drops the leading `v` (`"26.7.22"`). Note the letter suffix form (`26.7.22a`) is not strictly valid semver — it has been used before (`26.5.28d`, `26.5.9f`) without breaking electron-builder, but if a build ever fails on version parsing, that is the first thing to check.
- Commit message convention: `vYY.M.D[letter] <korean summary>` (see `git log`).
- In-code `// 🆕 vYY.M.D` markers use the version the change actually ships in — don't renumber them later, and don't add a letter suffix to markers for work that hasn't shipped yet.

## Architecture

Three-layer Electron app, no bundler, no framework:

```
main.js          ← Electron main process: windows, tray, IPC handlers, alwaysOnTop tricks, autoStart
preload.js       ← contextBridge: exposes window.electronAPI (typed-ish IPC) + window.storage (legacy adapter)
renderer/app.js  ← single 4000+ line UI module: state, rendering, modals, all event bindings, sync orchestration
sync/            ← main-process-only modules called via IPC from app.js
  google-auth.js          OAuth flow + selectedCalendars list
  google-calendar.js      multi-calendar two-way sync (per-calendar syncToken)
  google-tasks.js         tasks two-way sync
  nextcloud-auth.js       credentials + selectedCalendars list
  nextcloud-calendar.js   CalDAV multi-calendar sync (per-calendar ETag map, ICAL.js)
```

Renderer ↔ main is contextIsolated; renderer never `require()`s Node modules. All Google/NextCloud network I/O lives in `sync/*` and is invoked from the renderer through `window.electronAPI.*` (defined in `preload.js`). When you add a new sync capability, you must touch all three: handler in `main.js` → bridge in `preload.js` → caller in `renderer/app.js`.

### State model (renderer)

`state` (top of `renderer/app.js`) is the single source of truth: `events[]`, `memos[]`, `categories[]`, layout/opacity/font, auth status, `googleSelectedCalendars`, `nextcloudSelectedCalendars`, `calendarColors` / `calendarMeta` lookups, `syncedRange`. Everything writes to `state` then calls `renderCalendar()` / `renderMemos()`. Persistence uses `loadJSON`/`saveJSON` keys: `cal_events_v4`, `cal_memos_v4`, `cal_settings_v4`, `cal_categories_v1`. Bumping the schema means bumping the version suffix and writing a migration in `loadAll()` (see `v26.5.8f` orphan migration there for the pattern).

### Event identity & sources

Each event has a `source` of `'local' | 'google' | 'nextcloud'` plus source-specific fields:
- Google: `googleId` + `googleCalendarId`; renderer id = `g_<calendarId>_<googleId>`
- NextCloud: `ncUrl`, `ncEtag`, `ncCalendarUrl`
- Local: random `uid()` id, optional `categoryId` (see Local categories below — kept on the event even after a push to a remote source)

Color resolution flows through `eventColor()`. For local events: category color → `sourceColor('local')`. For remote events: user-picked per-calendar `customColor` (`state.calendarMeta[source][id].custom`) → name-matched category color → calendar's default backgroundColor (`state.calendarColors`) → `sourceColor()` fallback. Don't hardcode source colors in new code; route through these helpers so the user's color customization keeps working.

### Local categories (v26.7.22)

`state.categories` (`[{id, name, color}]`, persisted under `cal_categories_v1`) gives local events a "my calendars" grouping. Local events carry `categoryId`. **The list starts empty** — every local event is `(분류 없음)` until the user creates categories themselves in the manager modal; never seed names, since the name is the join key to a remote calendar and an app-chosen name would silently bind to the wrong calendar. (`loadAll()` carries a v26.7.22 migration that drops the short-lived 업무/개인/가족 seed when untouched and unused.)

**Name is the join key between a category and a remote calendar.** `findCalendarByName()` / `categoryByName()` compare trimmed + lowercased names, and that single convention drives the whole round trip:

- Changing 저장 위치 from local → google/nextcloud auto-selects the calendar whose display name equals the category name (in `updateEventCalendarDropdown`), and `saveEvent()` re-forces that calendar just before push. If no such calendar exists, the event is pushed to the selected calendar and keeps its `categoryId` so the color survives.
- Events synced *down* from a calendar named e.g. "업무" resolve back to that category via `eventCategory()` — remote events never store `categoryId` server-side, the name match recovers it.

`state.calendarMeta.{google,nextcloud}` (`{ '<id|url>': { name, custom } }`) is rebuilt alongside `state.calendarColors` in `refreshGoogleAuthStatus` / `refreshNextcloudAuthStatus`; `custom` records whether the user explicitly picked a color in the calendar modal, which is what lets an explicit color outrank the category color. If you add a new remote source, populate both maps.

The category manager modal (`catModalBg`, `openCategoryModal`) edits a `catDraft` copy; on save, events pointing at deleted categories have `categoryId` stripped. Duplicate names are rejected — they would make the remote-calendar match ambiguous. It can be opened stacked on top of the event modal via the dropdown's `＋ 새 카테고리 만들기…` entry (`CAT_NEW_OPTION`); in that case `closeCategoryModal()` must re-assert `modalAotBypass(true)` rather than restoring alwaysOnTop, or the still-open event modal loses keyboard input.

### Sync state

Each `sync/*` module owns its own encrypted `electron-store` (`google-tokens`, `google-calendar-sync`, `nextcloud-calendar-sync`, etc.) with an `encryptionKey`. Per-calendar sync state is keyed (`syncToken_<calendarId>` for Google, `etagMap_<base64UrlHash>` for NextCloud) so unselecting a calendar can drop just its token. `clearSyncState()` exists on each module and is called when selected-calendar lists change to force a re-fullSync. Don't bypass this — partial sync state across selection changes was a recurring bug class.

### Range sync

The renderer maintains `state.syncedRange.{google,nextcloud}` and calls `ensureRangeSynced()` whenever the visible 5-week window moves (debounced via `debouncedEnsureRangeSynced()`). When the visible range exits the synced range, `fetchAndMergeGoogle/Nextcloud` is called, which uses the `fetch-google-range` / `fetch-nextcloud-range` IPC (no syncToken — pure fetch, can't detect deletions). Default sync window is `PAST_DAYS=7, FUTURE_DAYS=56`. Auto-sync runs every 5 minutes; first sync is delayed 1.5–1.8s after boot to let the UI paint.

### Recurrence (RRULE)

Recurrence logic lives entirely in the renderer (`parseRrule` / `buildRrule` / `expandRruleDates` / `expandRecurrencesForRange`). Supported subset: `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `COUNT`, `UNTIL`, single `BYDAY` token on `MONTHLY` (e.g. `3TH`, `-1FR` → `r.byday = {ordinal, dow}`), multi-`BYDAY` (no ordinals) on `WEEKLY` (e.g. `MO,WE,FR` → `r.bydays = [1,3,5]`), and multi-`BYDAY` with ordinals on `MONTHLY` (e.g. `1MO,3MO` → `r.bydaysMonthly = [{ordinal,dow}, ...]`, v26.5.8o). `BYMONTHDAY` and `BYSETPOS` are **not** supported — extending requires changes here, not in `sync/*`. The three byday fields (`byday` / `bydays` / `bydaysMonthly`) are mutually exclusive — don't merge them. WEEKLY+BYDAY auto-includes the master's start-day, and MONTHLY multi-BYDAY auto-includes the master's start-ordinal, so the master date is always the first occurrence. The MONTHLY multi-BYDAY UI is intentionally limited to a single dow (inferred from start date) with multiple ordinals; the parser accepts mixed-dow patterns but the form only emits single-dow. NextCloud round-trips RRULE/EXDATE through ICAL.js; Google currently does **not** push recurrence (events are pushed as singletons). Detached instances are stored as separate events with `recurrenceId` pointing at the master; `originalMasterTime` must be preserved on detach so NextCloud can match by RECURRENCE-ID.

### alwaysOnTop modal trick

The widget runs with `alwaysOnTop=true`, which on Windows prevents OS-level focus from entering the window — keyboard input goes to the previously active app. Modals call `electronAPI.modalAotBypass(true)` on open (drops alwaysOnTop, restores, focuses) and `(false)` on close (restores from store). If you add a new modal, wire both calls or text inputs will silently fail. See `openEventModal` / `closeEventModal` for the canonical pattern. The older `focusWindow()` IPC alone is insufficient.

### Tray and `--hidden`

`main.js` registers auto-launch via `app.setLoginItemSettings`, but **only when packaged** — calling it in dev mode points login at `electron.exe` and opens the Electron welcome screen on boot. The `--hidden` arg suppresses the initial show in `ready-to-show`. Closing the window hides to tray; only `isQuitting=true` (set by tray "종료" or `app-quit` IPC) actually exits.

## Editing conventions

- The renderer is intentionally one file. Don't split it into modules without a clear reason — the existing section banners (`╔═══╗` boxes) are the navigation aid.
- Korean comments and UI strings are the norm; new code in this codebase should follow.
- Version markers like `// 🆕 v26.5.8b` annotate when behavior was added/changed and double as searchable change history. Use them when introducing non-obvious behavior, but don't add them gratuitously to refactors.
- Storage schema versions live in key suffixes (`cal_events_v4`). Bumping = writing a migration in `loadAll()`.
