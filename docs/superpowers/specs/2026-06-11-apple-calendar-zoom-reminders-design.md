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

- `readAppleCalendarMeetings(nowMs, horizonMs): Promise<CalendarMeeting[]>` — runs `/usr/bin/osascript -l JavaScript` (JXA) via `execFile`, **90 s timeout**, parses JSON from stdout. In-flight promise dedup (poll ticks must not stack osascript runs) and negative caching on failure (keep stale meetings, don't respawn every tick).
- JXA script queries Calendar.app across all calendars. **As-built notes from live verification (2026-06-11, real Exchange calendar, 542 events / 272 recurring masters):**
  - Calendar.app scripting does NOT expand recurring events — masters keep their original start date; expansion happens in the mapper.
  - `whose({recurrence: {_notEqualTo: null}})` throws "Illegal comparison or logical" on every calendar — use `recurrence` begins-with `"FREQ"` filtering. (Verified live; the notEqualTo form silently returned zero recurring meetings.)
  - Per-event property access costs one Apple Event each (~100 s total); `whose`-query bulk reads re-evaluate the filter per property (~5 min). The only viable shape: bulk property arrays over ALL events per calendar (`events.uid()`, `events.startDate()`, …), index selection in JS. Measured ~40-45 s end-to-end.
  - `description` is deliberately NOT fetched — event bodies dominate runtime, and Zoom's Outlook add-in puts the join link in location/URL (272/272 events verified). Known limitation: meetings whose Zoom link exists only in the body are missed by this source.
  Output per event: `{uid, title, startMs, endMs, location, description: "", url, rrule, excludedDatesMs[]}` (rrule = Calendar.app `recurrence` string, RRULE-format).
- Pure mapper `mapAppleCalendarEvents(events, nowMs, horizonMs): CalendarMeeting[]`:
  - Zoom link extraction via existing `extractZoomJoinUrl` from icsCalendar.ts over url + location + description.
  - Recurring expansion reuses icsCalendar's exported `expandRecurringEvent` (DAILY/WEEKLY with INTERVAL/COUNT/UNTIL/BYDAY). Occurrences matching `excludedDatesMs` are skipped with ±1 h tolerance (fixed-step expansion vs wall-clock exclusions drift across DST).
  - Dedup not needed here (main.ts dedupes globally); sort by startMs.
- In-module cache: 5 min (`ZOOM_MEETING_APPLE_CACHE_MS`) — 2 min was the original plan but a ~40 s scan every 2 min is a 33% duty cycle; 5 min stays within the 10-min start-grace window.
- main.ts `dedupeZoomMeetings` keys on `startMs + Zoom meeting number` (not uid) — the same meeting arrives from multiple sources with different uids (verified: Apple Calendar and the drop file returned the same meeting, same join URL, different uids).
- Future fast-path (not in v1): EventKit via JXA ObjC bridge — milliseconds, recurrences pre-expanded, but the full-access TCC prompt requires `NSCalendarsFullAccessUsageDescription` from the responsible app, which can't be live-verified outside a packaged build. Revisit if the 40 s scan becomes a problem.

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
