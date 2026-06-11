import assert from "node:assert/strict";
import { mapAppleCalendarEvents } from "../src/main/appleCalendar";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 4, 28, 16, 0, 0);
const HORIZON = 3 * HOUR;

function appleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: "event-1",
    title: "Metrics review",
    startMs: NOW + 30 * MINUTE,
    endMs: NOW + 60 * MINUTE,
    location: "",
    description: "",
    url: "https://example.zoom.us/j/123456789?pwd=abc",
    rrule: "",
    excludedDatesMs: [],
    ...overrides
  };
}

export const tests = [
  {
    name: "mapAppleCalendarEvents extracts the Zoom link from url, location, and description",
    run(): void {
      const meetings = mapAppleCalendarEvents(
        [
          appleEvent({ uid: "from-url", url: "https://example.zoom.us/j/111?pwd=u" }),
          appleEvent({ uid: "from-location", url: "", location: "https://example.zoom.us/j/222?pwd=l" }),
          appleEvent({
            uid: "from-description",
            url: "",
            description: "Join Zoom Meeting https://example.zoom.us/j/333?pwd=d"
          }),
          appleEvent({ uid: "no-zoom", url: "https://example.com/meet" })
        ],
        NOW,
        HORIZON
      );

      assert.deepEqual(
        meetings.map((meeting) => [meeting.uid, meeting.joinUrl]),
        [
          ["from-url", "https://example.zoom.us/j/111?pwd=u"],
          ["from-location", "https://example.zoom.us/j/222?pwd=l"],
          ["from-description", "https://example.zoom.us/j/333?pwd=d"]
        ]
      );
    }
  },
  {
    name: "mapAppleCalendarEvents keeps only meetings inside the reminder window",
    run(): void {
      const meetings = mapAppleCalendarEvents(
        [
          appleEvent({ uid: "too-old", startMs: NOW - 6 * MINUTE, endMs: NOW + 24 * MINUTE }),
          appleEvent({ uid: "just-started", startMs: NOW - 4 * MINUTE, endMs: NOW + 26 * MINUTE }),
          appleEvent({ uid: "upcoming", startMs: NOW + HOUR, endMs: NOW + HOUR + 30 * MINUTE }),
          appleEvent({ uid: "too-far", startMs: NOW + HORIZON + MINUTE, endMs: NOW + HORIZON + HOUR })
        ],
        NOW,
        HORIZON
      );

      assert.deepEqual(
        meetings.map((meeting) => meeting.uid),
        ["just-started", "upcoming"]
      );
    }
  },
  {
    name: "mapAppleCalendarEvents expands weekly recurring events with BYDAY",
    run(): void {
      const meetings = mapAppleCalendarEvents(
        [
          appleEvent({
            uid: "weekly-1",
            title: "Weekly sync",
            startMs: Date.UTC(2026, 4, 21, 17, 0, 0),
            endMs: Date.UTC(2026, 4, 21, 17, 30, 0),
            rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=TH"
          })
        ],
        NOW,
        HORIZON
      );

      assert.equal(meetings.length, 1);
      assert.equal(meetings[0].uid, "weekly-1");
      assert.equal(meetings[0].startMs, Date.UTC(2026, 4, 28, 17, 0, 0));
      assert.equal(meetings[0].endMs, Date.UTC(2026, 4, 28, 17, 30, 0));
    }
  },
  {
    name: "mapAppleCalendarEvents expands daily recurring events",
    run(): void {
      const meetings = mapAppleCalendarEvents(
        [
          appleEvent({
            uid: "daily-1",
            startMs: Date.UTC(2026, 4, 26, 17, 0, 0),
            endMs: Date.UTC(2026, 4, 26, 17, 15, 0),
            rrule: "FREQ=DAILY;INTERVAL=1"
          })
        ],
        NOW,
        HORIZON
      );

      assert.equal(meetings.length, 1);
      assert.equal(meetings[0].startMs, Date.UTC(2026, 4, 28, 17, 0, 0));
    }
  },
  {
    name: "mapAppleCalendarEvents honors COUNT on recurring events",
    run(): void {
      const base = {
        title: "Weekly sync",
        startMs: Date.UTC(2026, 4, 21, 17, 0, 0),
        endMs: Date.UTC(2026, 4, 21, 17, 30, 0)
      };
      const expired = mapAppleCalendarEvents(
        [appleEvent({ ...base, uid: "count-1", rrule: "FREQ=WEEKLY;COUNT=1;BYDAY=TH" })],
        NOW,
        HORIZON
      );
      const active = mapAppleCalendarEvents(
        [appleEvent({ ...base, uid: "count-2", rrule: "FREQ=WEEKLY;COUNT=2;BYDAY=TH" })],
        NOW,
        HORIZON
      );

      assert.equal(expired.length, 0);
      assert.equal(active.length, 1);
      assert.equal(active[0].startMs, Date.UTC(2026, 4, 28, 17, 0, 0));
    }
  },
  {
    name: "mapAppleCalendarEvents honors UNTIL on recurring events",
    run(): void {
      const meetings = mapAppleCalendarEvents(
        [
          appleEvent({
            uid: "until-1",
            startMs: Date.UTC(2026, 4, 21, 17, 0, 0),
            endMs: Date.UTC(2026, 4, 21, 17, 30, 0),
            rrule: "FREQ=WEEKLY;UNTIL=20260527T000000Z;BYDAY=TH"
          })
        ],
        NOW,
        HORIZON
      );

      assert.equal(meetings.length, 0);
    }
  },
  {
    name: "mapAppleCalendarEvents skips excluded occurrences",
    run(): void {
      const meetings = mapAppleCalendarEvents(
        [
          appleEvent({
            uid: "excluded-1",
            startMs: Date.UTC(2026, 4, 21, 17, 0, 0),
            endMs: Date.UTC(2026, 4, 21, 17, 30, 0),
            rrule: "FREQ=WEEKLY;BYDAY=TH",
            excludedDatesMs: [Date.UTC(2026, 4, 28, 17, 0, 0)]
          })
        ],
        NOW,
        HORIZON
      );

      assert.equal(meetings.length, 0);
    }
  },
  {
    name: "mapAppleCalendarEvents matches exclusions with DST tolerance",
    run(): void {
      const occurrence = Date.UTC(2026, 4, 28, 17, 0, 0);
      const farEvent = {
        uid: "excluded-far",
        startMs: Date.UTC(2026, 4, 21, 17, 0, 0),
        endMs: Date.UTC(2026, 4, 21, 17, 30, 0),
        rrule: "FREQ=WEEKLY;BYDAY=TH"
      };

      const shiftedHour = mapAppleCalendarEvents(
        [appleEvent({ ...farEvent, excludedDatesMs: [occurrence + 60 * MINUTE] })],
        NOW,
        HORIZON
      );
      assert.equal(shiftedHour.length, 0);

      const shiftedTwoHours = mapAppleCalendarEvents(
        [appleEvent({ ...farEvent, excludedDatesMs: [occurrence + 2 * 60 * MINUTE] })],
        NOW,
        HORIZON
      );
      assert.equal(shiftedTwoHours.length, 1);
    }
  },
  {
    name: "mapAppleCalendarEvents tolerates malformed events and fills fallbacks",
    run(): void {
      const meetings = mapAppleCalendarEvents(
        [
          null,
          42,
          appleEvent({ uid: "missing-start", startMs: null }),
          appleEvent({ uid: "string-start", startMs: "tomorrow" }),
          appleEvent({ uid: "missing-end", endMs: undefined }),
          appleEvent({ uid: "", title: "", excludedDatesMs: "oops" })
        ],
        NOW,
        HORIZON
      );

      assert.equal(meetings.length, 1);
      assert.equal(meetings[0].title, "Zoom meeting");
      assert.equal(meetings[0].uid, `Zoom meeting:${NOW + 30 * MINUTE}`);
    }
  },
  {
    name: "mapAppleCalendarEvents sorts meetings by start time",
    run(): void {
      const meetings = mapAppleCalendarEvents(
        [
          appleEvent({ uid: "later", startMs: NOW + 2 * HOUR, endMs: NOW + 2 * HOUR + 30 * MINUTE }),
          appleEvent({ uid: "sooner", startMs: NOW + 30 * MINUTE, endMs: NOW + HOUR })
        ],
        NOW,
        HORIZON
      );

      assert.deepEqual(
        meetings.map((meeting) => meeting.uid),
        ["sooner", "later"]
      );
    }
  }
];
