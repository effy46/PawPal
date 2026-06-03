import assert from "node:assert/strict";
import { extractZoomJoinUrl, parseIcsZoomMeetings } from "../src/main/icsCalendar";

const NOW = Date.UTC(2026, 4, 28, 16, 0, 0);

export const tests = [
  {
    name: "extractZoomJoinUrl reads Zoom meeting links",
    run(): void {
      assert.equal(
        extractZoomJoinUrl("Join: https://chewy.zoom.us/j/123456789?pwd=abc."),
        "https://chewy.zoom.us/j/123456789?pwd=abc"
      );
      assert.equal(extractZoomJoinUrl("Share Screen"), null);
    }
  },
  {
    name: "parseIcsZoomMeetings parses one-time Zoom meetings",
    run(): void {
      const meetings = parseIcsZoomMeetings(
        [
          "BEGIN:VCALENDAR",
          "BEGIN:VEVENT",
          "UID:meeting-1",
          "SUMMARY:Metrics review",
          "DTSTART:20260528T163000Z",
          "DTEND:20260528T170000Z",
          "DESCRIPTION:Join Zoom Meeting https://example.zoom.us/j/111222333?pwd=hello",
          "END:VEVENT",
          "END:VCALENDAR"
        ].join("\n"),
        NOW,
        2 * 60 * 60 * 1000
      );

      assert.equal(meetings.length, 1);
      assert.equal(meetings[0].title, "Metrics review");
      assert.equal(meetings[0].joinUrl, "https://example.zoom.us/j/111222333?pwd=hello");
    }
  },
  {
    name: "parseIcsZoomMeetings expands weekly recurring Zoom meetings",
    run(): void {
      const meetings = parseIcsZoomMeetings(
        [
          "BEGIN:VCALENDAR",
          "BEGIN:VEVENT",
          "UID:weekly-1",
          "SUMMARY:Weekly sync",
          "DTSTART:20260521T170000Z",
          "DTEND:20260521T173000Z",
          "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=TH",
          "LOCATION:https://example.zoom.us/j/999888777",
          "END:VEVENT",
          "END:VCALENDAR"
        ].join("\n"),
        NOW,
        3 * 60 * 60 * 1000
      );

      assert.equal(meetings.length, 1);
      assert.equal(meetings[0].title, "Weekly sync");
      assert.equal(meetings[0].startMs, Date.UTC(2026, 4, 28, 17, 0, 0));
    }
  }
];
