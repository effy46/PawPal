import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expandRecurringEvent, extractZoomJoinUrl } from "./icsCalendar";
import type { CalendarMeeting } from "./icsCalendar";

export const ZOOM_MEETING_APPLE_CACHE_MS = 5 * 60 * 1000;

// Bulk Calendar.app reads take ~40s on a busy Exchange calendar; the timeout must
// stay well above that, and the cache TTL keeps the duty cycle low.
const OSASCRIPT_TIMEOUT_MS = 90_000;
const OSASCRIPT_MAX_BUFFER = 10 * 1024 * 1024;
const START_GRACE_MS = 5 * 60 * 1000;
const EXCLUSION_TOLERANCE_MS = 60 * 60 * 1000;

const execFileAsync = promisify(execFile);

type RawAppleCalendarEvent = {
  uid?: unknown;
  title?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  location?: unknown;
  description?: unknown;
  url?: unknown;
  rrule?: unknown;
  excludedDatesMs?: unknown;
};

// Calendar.app scripting does not expand recurring events (masters keep their original
// start date), whose-clauses on the recurrence property throw "Illegal comparison or
// logical", and per-event property access costs one Apple Event each (~100s on a busy
// Exchange calendar). So: bulk-fetch property arrays per calendar (one Apple Event per
// property), pick relevant indexes in JS, and expand recurring masters in the mapper.
// The description field is skipped on purpose — bulk-reading event bodies dominates the
// runtime, and Zoom's Outlook add-in always puts the join link in the location/URL field.
const JXA_SCRIPT = `
function run(argv) {
  var lower = Number(argv[0]);
  var upper = Number(argv[1]);
  var calendarApp = Application("Calendar");
  var calendars = calendarApp.calendars();
  var events = [];
  var seen = {};
  for (var i = 0; i < calendars.length; i += 1) {
    var calendarEvents = calendars[i].events;
    var uids, starts, ends, rrules;
    try {
      uids = calendarEvents.uid();
      starts = calendarEvents.startDate();
      ends = calendarEvents.endDate();
      rrules = calendarEvents.recurrence();
    } catch (error) {
      continue;
    }
    var wanted = [];
    for (var j = 0; j < uids.length; j += 1) {
      var startMs = starts[j] ? starts[j].getTime() : null;
      if (startMs === null) continue;
      var rule = rrules[j] ? String(rrules[j]) : "";
      var inWindow = startMs >= lower && startMs <= upper;
      var recurringMaster = rule.indexOf("FREQ") === 0 && startMs < upper;
      if (inWindow || recurringMaster) wanted.push(j);
    }
    if (!wanted.length) continue;
    var titles, locations, urls, excluded;
    try {
      titles = calendarEvents.summary();
      locations = calendarEvents.location();
      urls = calendarEvents.url();
      excluded = calendarEvents.excludedDates();
    } catch (error) {
      continue;
    }
    for (var w = 0; w < wanted.length; w += 1) {
      var index = wanted[w];
      var uid = String(uids[index] || "");
      if (uid && seen[uid]) continue;
      if (uid) seen[uid] = true;
      var exclusions = excluded[index] || [];
      var excludedDatesMs = [];
      for (var k = 0; k < exclusions.length; k += 1) {
        excludedDatesMs.push(exclusions[k].getTime());
      }
      events.push({
        uid: uid,
        title: String(titles[index] || ""),
        startMs: starts[index].getTime(),
        endMs: ends[index] ? ends[index].getTime() : null,
        location: String(locations[index] || ""),
        description: "",
        url: String(urls[index] || ""),
        rrule: rrules[index] ? String(rrules[index]) : "",
        excludedDatesMs: excludedDatesMs
      });
    }
  }
  return JSON.stringify(events);
}
`;

let appleCalendarCache: { fetchedAt: number; meetings: CalendarMeeting[] } | null = null;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function timeMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function excludedList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((ms): ms is number => typeof ms === "number" && Number.isFinite(ms));
}

export function isAppleCalendarPermissionError(error: unknown): boolean {
  const parts =
    error instanceof Error
      ? [error.message, String((error as { stderr?: unknown }).stderr ?? "")]
      : [String(error)];
  const message = parts.join("\n");
  return message.includes("-1743") || /not authori[sz]ed/i.test(message);
}

export function mapAppleCalendarEvents(events: unknown[], nowMs: number, horizonMs: number): CalendarMeeting[] {
  const meetings: CalendarMeeting[] = [];
  const lowerBound = nowMs - START_GRACE_MS;
  const upperBound = nowMs + horizonMs;

  for (const value of events) {
    if (!value || typeof value !== "object") continue;
    const item = value as RawAppleCalendarEvent;
    const startMs = timeMs(item.startMs);
    const endMs = timeMs(item.endMs);
    if (startMs === null || endMs === null) continue;
    const joinUrl = extractZoomJoinUrl(`${text(item.url)}\n${text(item.location)}\n${text(item.description)}`);
    if (!joinUrl) continue;
    const title = text(item.title) || "Zoom meeting";
    const uid = text(item.uid) || `${title}:${startMs}`;
    const rrule = text(item.rrule);

    if (rrule) {
      // Occurrences are computed with fixed 24h/7d steps while Calendar.app records
      // exclusions wall-clock anchored, so they drift apart by 1h across a DST
      // transition — match exclusions with tolerance instead of exact equality.
      const excluded = excludedList(item.excludedDatesMs);
      const occurrences = expandRecurringEvent({ uid, title, startMs, endMs, rrule }, nowMs, horizonMs, joinUrl);
      meetings.push(
        ...occurrences.filter(
          (occurrence) => !excluded.some((ms) => Math.abs(ms - occurrence.startMs) <= EXCLUSION_TOLERANCE_MS)
        )
      );
      continue;
    }

    if (startMs >= lowerBound && startMs <= upperBound) {
      meetings.push({ uid, title, startMs, endMs: startMs + Math.max(0, endMs - startMs), joinUrl });
    }
  }

  return meetings.sort((left, right) => left.startMs - right.startMs);
}

let appleCalendarInFlight: Promise<CalendarMeeting[]> | null = null;

export function clearAppleCalendarMeetingCache(): void {
  appleCalendarCache = null;
}

async function fetchAppleCalendarMeetings(nowMs: number, horizonMs: number): Promise<CalendarMeeting[]> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", JXA_SCRIPT, String(nowMs - START_GRACE_MS), String(nowMs + horizonMs)],
      { timeout: OSASCRIPT_TIMEOUT_MS, maxBuffer: OSASCRIPT_MAX_BUFFER }
    );
    const parsed: unknown = JSON.parse(stdout.trim());
    const meetings = mapAppleCalendarEvents(Array.isArray(parsed) ? parsed : [], nowMs, horizonMs);
    appleCalendarCache = { fetchedAt: nowMs, meetings };
    return meetings;
  } catch (error) {
    // Negative-cache the failure (keeping any stale meetings) so a broken Calendar.app
    // does not respawn a long osascript run on every poll tick.
    appleCalendarCache = { fetchedAt: nowMs, meetings: appleCalendarCache?.meetings ?? [] };
    throw error;
  }
}

export async function readAppleCalendarMeetings(
  nowMs = Date.now(),
  horizonMs = 12 * 60 * 60 * 1000
): Promise<CalendarMeeting[]> {
  if (appleCalendarCache && nowMs - appleCalendarCache.fetchedAt < ZOOM_MEETING_APPLE_CACHE_MS) {
    return appleCalendarCache.meetings;
  }
  if (!appleCalendarInFlight) {
    appleCalendarInFlight = fetchAppleCalendarMeetings(nowMs, horizonMs).finally(() => {
      appleCalendarInFlight = null;
    });
  }
  return appleCalendarInFlight;
}
