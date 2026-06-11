import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readZoomMeetingCache } from "../src/main/zoomMeetingCache";

const NOW = Date.UTC(2026, 5, 11, 17, 0, 0);

export const tests = [
  {
    name: "readZoomMeetingCache reads Outlook bridge meetings",
    async run(): Promise<void> {
      const dir = join(tmpdir(), `pawpal-cache-${Date.now()}`);
      await mkdir(dir, { recursive: true });
      const file = join(dir, "outlook-meetings.json");
      await writeFile(
        file,
        JSON.stringify({
          meetings: [
            {
              id: "event-1",
              subject: "Rx Science Review",
              start: "2026-06-11T18:30:00.000Z",
              end: "2026-06-11T19:00:00.000Z",
              joinUrl: "https://chewy.zoom.us/j/87378930698?from=addon"
            },
            {
              id: "event-2",
              subject: "Not Zoom",
              start: "2026-06-11T18:30:00.000Z",
              end: "2026-06-11T19:00:00.000Z",
              joinUrl: "https://example.com/meeting"
            }
          ]
        }),
        "utf8"
      );

      const meetings = await readZoomMeetingCache(file, NOW, 4 * 60 * 60 * 1000);
      assert.equal(meetings.length, 1);
      assert.equal(meetings[0].uid, "event-1");
      assert.equal(meetings[0].title, "Rx Science Review");
      assert.equal(meetings[0].startMs, Date.UTC(2026, 5, 11, 18, 30, 0));
    }
  },
  {
    name: "readZoomMeetingCache ignores missing cache",
    async run(): Promise<void> {
      const meetings = await readZoomMeetingCache(join(tmpdir(), "missing-pawpal-cache.json"), NOW);
      assert.deepEqual(meetings, []);
    }
  }
];
