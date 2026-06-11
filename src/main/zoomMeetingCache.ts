import { readFile } from "node:fs/promises";
import type { CalendarMeeting } from "./icsCalendar";

type CachedMeeting = {
  uid?: unknown;
  id?: unknown;
  title?: unknown;
  subject?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  start?: unknown;
  end?: unknown;
  joinUrl?: unknown;
  join_url?: unknown;
  url?: unknown;
};

type CachePayload = {
  meetings?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function timeMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeCachedMeeting(value: unknown): CalendarMeeting | null {
  if (!value || typeof value !== "object") return null;
  const item = value as CachedMeeting;
  const startMs = timeMs(item.startMs ?? item.start);
  const endMs = timeMs(item.endMs ?? item.end);
  const joinUrl = text(item.joinUrl ?? item.join_url ?? item.url);
  if (!startMs || !endMs || !joinUrl) return null;
  if (!/https?:\/\/[^\s<>"')]+\.zoom\.us\//i.test(joinUrl)) return null;
  const title = text(item.title ?? item.subject) || "Zoom meeting";
  return {
    uid: text(item.uid ?? item.id) || `${title}:${startMs}`,
    title,
    startMs,
    endMs,
    joinUrl
  };
}

export async function readZoomMeetingCache(
  filePath: string,
  nowMs = Date.now(),
  horizonMs = 12 * 60 * 60 * 1000
): Promise<CalendarMeeting[]> {
  let payload: CachePayload;
  try {
    payload = JSON.parse(await readFile(filePath, "utf8")) as CachePayload;
  } catch {
    return [];
  }
  if (!Array.isArray(payload.meetings)) return [];
  const lowerBound = nowMs - 10 * 60 * 1000;
  const upperBound = nowMs + horizonMs;
  return payload.meetings
    .map(normalizeCachedMeeting)
    .filter((meeting): meeting is CalendarMeeting => Boolean(meeting))
    .filter((meeting) => meeting.endMs >= lowerBound && meeting.startMs <= upperBound)
    .sort((left, right) => left.startMs - right.startMs);
}
