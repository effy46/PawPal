# Apple Calendar Zoom Reminders + Bubble Restyle — Design

Date: 2026-06-11
Status: approved (Fiona, in-session)

## Goal

Reliable PawPal Zoom meeting reminders for users whose company blocks Outlook ICS publish. Two workstreams:

1. **Apple Calendar source** — new auto-refreshing meeting source read locally from macOS Calendar.app.
2. **Speech bubble restyle** — bring `.speech-bubble` into the hand-drawn comic register (pencil outline + sticker shadow) per DESIGN.md "one bubble language".

## Context

`readZoomMeetings` (src/main/main.ts) already merges + dedupes multiple sources:
- ICS URL fetch (`readZoomMeetingsFromIcs`, 5-min cache)
- Drop file `outlook-meetings.json` in userData (`src/main/zoomMeetingCache.ts`) — written externally (e.g. Codex automation). Keep untouched.

Apple Calendar becomes a third merged input. Sources are additive, not exclusive.

## Workstream 1: Apple Calendar source

### Settings

- New field `zoomMeetingAppleCalendarEnabled: boolean`, default `false` (src/shared/types.ts, constants.ts, settingsStore normalization + tests).
- SettingsView: toggle row "Read meetings from Apple Calendar" inside the Zoom-reminders block, next to the ICS URL input. Visible on macOS only (follow the existing pattern used to gate macOS-only features, e.g. zoom share). i18n labels en + zh-CN in src/shared/i18n.ts: toggle label, hint, permission-error bubble text.

### New module `src/main/appleCalendar.ts`

- `readAppleCalendarMeetings(nowMs, horizonMs): Promise<CalendarMeeting[]>` — runs `/usr/bin/osascript -l JavaScript` (JXA) via `execFile`, 30 s timeout, parses JSON from stdout.
- JXA script queries Calendar.app across all calendars. **Critical: Calendar.app scripting does NOT expand recurring events** — masters keep their original start date. Per calendar, fetch two sets:
  1. Events whose startDate is within [now − 5 min, now + horizon] (one-off + masters starting in window).
  2. Events whose recurrence is non-empty and startDate < window end (recurring masters).
  Output per event: `{uid, title, startMs, endMs, location, description, url, rrule, excludedDatesMs[]}` (rrule = Calendar.app `recurrence` string, RRULE-format).
- Pure mapper `mapAppleCalendarEvents(events, nowMs, horizonMs): CalendarMeeting[]`:
  - Zoom link extraction via existing `extractZoomJoinUrl` from icsCalendar.ts over url + location + description.
  - Recurring expansion reuses icsCalendar's RRULE expansion (export/extract the existing `expandRecurringEvent` logic into a shared helper rather than duplicating; DAILY/WEEKLY with INTERVAL/COUNT/UNTIL/BYDAY as already supported). Skip occurrences in `excludedDatesMs`.
  - Dedup not needed here (main.ts dedupes globally); sort by startMs.
- In-module cache: 2 min (`ZOOM_MEETING_APPLE_CACHE_MS = 120_000`) — fresher than the 5-min ICS cache to catch last-minute invites.

### main.ts wiring

- In `readZoomMeetings`, when `settings.zoomMeetingAppleCalendarEnabled` and `process.platform === "darwin"`, push Apple Calendar meetings into the merge. Existing dedupe + reminder pipeline unchanged.
- Error handling mirrors ICS path: permission denial (osascript error -1743 / "Not authorized") → one-time bubble telling user to allow PawPal under System Settings → Privacy & Security → Automation; other failures → reuse the existing one-shot error-bubble pattern. Apple-source failure must never block the other sources.

### Packaging/permissions

- package.json `build.mac.extendInfo.NSAppleEventsUsageDescription`: "PawPal reads your calendar to remind you about Zoom meetings."
- `build/entitlements.mac.plist`: add `com.apple.security.automation.apple-events` (true).
- Dev mode needs nothing (prompt attributes to the terminal).

### Tests

- `tests/appleCalendar.test.ts`: mapper unit tests — zoom URL extraction across fields, window filtering, recurring expansion (weekly BYDAY, COUNT/UNTIL), excluded dates, malformed/missing fields, sort order. No osascript in tests.
- settingsStore tests: new field default + persisted round-trip.
- Shared-expansion refactor must keep all existing icsCalendar tests green.

## Workstream 2: Speech bubble restyle

`src/renderer/src/styles.css` only. Upgrade `.speech-bubble` (affects ALL reminder bubbles — intended):

- `border: 2px solid #24201c` (Pencil Outline)
- `box-shadow: 2px 3px 0 rgba(36, 32, 28, 0.18)` (sticker shadow; pairing required by Sticker Shadow Rule)
- Tail becomes outlined: stacked CSS triangles — `::before` ink triangle (#24201c, slightly larger/lower) under `::after` cream triangle — replacing the current single-triangle `::after`.
- Keep: Bubble Cream rgba(255,252,244,0.96), 16px radius, centered 13px text, pill `.bubble-button` styles, fonts (Handwriting Boundary Rule: no comic font here).

## Out of scope

- Windows/Linux calendar sources; Outlook drop-file changes; reminder timing logic; Shortcuts/EventKit helper; recurring FREQ beyond DAILY/WEEKLY (matches existing ICS support).

## Verification

`pnpm test` green + `tsc --noEmit` (via `pnpm build` typecheck step) + manual run confirming bubble style and (on Fiona's machine) live Apple Calendar read.
