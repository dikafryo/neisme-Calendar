# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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
Pushing a `v*` tag triggers `.github/workflows/build-{mac,win}.yml`, which builds and attaches artifacts to a GitHub Release automatically. `package.json` `version` should be bumped first. Existing commit-message convention: `vXX.Y.Zx <korean summary>` (see `git log`).

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

`state` (top of `renderer/app.js`) is the single source of truth: `events[]`, `memos[]`, layout/opacity/font, auth status, `googleSelectedCalendars`, `nextcloudSelectedCalendars`, `calendarColors` lookup, `syncedRange`. Everything writes to `state` then calls `renderCalendar()` / `renderMemos()`. Persistence uses `loadJSON`/`saveJSON` keys: `cal_events_v4`, `cal_memos_v4`, `cal_settings_v4`. Bumping the schema means bumping the `_v4` suffix and writing a migration in `loadAll()` (see `v26.5.8f` orphan migration there for the pattern).

### Event identity & sources

Each event has a `source` of `'local' | 'google' | 'nextcloud'` plus source-specific fields:
- Google: `googleId` + `googleCalendarId`; renderer id = `g_<calendarId>_<googleId>`
- NextCloud: `ncUrl`, `ncEtag`, `ncCalendarUrl`
- Local: random `uid()` id

Color resolution flows through `eventColor()` → `state.calendarColors` (per-source per-calendar customization) → calendar's default backgroundColor → `sourceColor()` fallback. Don't hardcode source colors in new code; route through these helpers so the user's color customization keeps working.

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
