export type CalendarMeeting = {
  uid: string;
  title: string;
  startMs: number;
  endMs: number;
  joinUrl: string;
};

type IcsEvent = {
  uid: string;
  title: string;
  startMs: number | null;
  endMs: number | null;
  status: string;
  location: string;
  description: string;
  url: string;
  rrule: string;
};

const WEEKDAY_INDEX: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6
};

function unfoldIcs(raw: string): string[] {
  return raw.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function propertyName(line: string): string {
  const separator = line.indexOf(":");
  if (separator < 0) return "";
  return line.slice(0, separator).split(";")[0].toUpperCase();
}

function propertyValue(line: string): string {
  const separator = line.indexOf(":");
  if (separator < 0) return "";
  return line.slice(separator + 1);
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsDate(value: string): number | null {
  const dateTime = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (dateTime) {
    const [, year, month, day, hour, minute, second, utc] = dateTime;
    const parts = [year, month, day, hour, minute, second].map(Number);
    const parsed = utc
      ? Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])
      : new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly.map(Number);
    const parsed = new Date(year, month - 1, day).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseRule(rule: string): Record<string, string> {
  return Object.fromEntries(
    rule
      .split(";")
      .map((part) => part.split("="))
      .filter((part): part is [string, string] => part.length === 2)
      .map(([key, value]) => [key.toUpperCase(), value])
  );
}

export function extractZoomJoinUrl(text: string): string | null {
  const normalized = unescapeIcsText(text).replace(/&amp;/g, "&");
  const match =
    normalized.match(/https?:\/\/[^\s<>"')]+\.zoom\.us\/j\/[^\s<>"')]+/i) ??
    normalized.match(/https?:\/\/[^\s<>"')]+\.zoom\.us\/[^\s<>"')]+/i);
  return match ? match[0].replace(/[.,;]+$/, "") : null;
}

function pushMeeting(
  meetings: CalendarMeeting[],
  event: IcsEvent,
  startMs: number,
  durationMs: number,
  joinUrl: string
): void {
  meetings.push({
    uid: event.uid || `${event.title}:${startMs}`,
    title: event.title || "Zoom meeting",
    startMs,
    endMs: startMs + durationMs,
    joinUrl
  });
}

function expandRecurringEvent(event: IcsEvent, nowMs: number, horizonMs: number, joinUrl: string): CalendarMeeting[] {
  const meetings: CalendarMeeting[] = [];
  if (!event.startMs || !event.endMs || !event.rrule) return meetings;
  const rule = parseRule(event.rrule);
  const freq = rule.FREQ;
  if (freq !== "DAILY" && freq !== "WEEKLY") return meetings;

  const interval = Math.max(1, Number(rule.INTERVAL ?? 1) || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : null;
  const untilMs = rule.UNTIL ? parseIcsDate(rule.UNTIL) : null;
  const durationMs = Math.max(0, event.endMs - event.startMs);
  const lowerBound = nowMs - 5 * 60 * 1000;
  const upperBound = nowMs + horizonMs;
  let emitted = 0;

  if (freq === "DAILY") {
    for (let occurrence = event.startMs; occurrence <= upperBound; occurrence += interval * 24 * 60 * 60 * 1000) {
      if (untilMs && occurrence > untilMs) break;
      emitted += 1;
      if (count && emitted > count) break;
      if (occurrence >= lowerBound) pushMeeting(meetings, event, occurrence, durationMs, joinUrl);
    }
    return meetings;
  }

  const byDays = (rule.BYDAY ? rule.BYDAY.split(",") : [Object.keys(WEEKDAY_INDEX)[new Date(event.startMs).getDay()]])
    .map((day) => WEEKDAY_INDEX[day.slice(-2)])
    .filter((day) => typeof day === "number");
  const start = new Date(event.startMs);
  const weekStart = new Date(start);
  weekStart.setDate(start.getDate() - start.getDay());

  for (let week = 0; week < 370; week += interval) {
    for (const weekday of byDays) {
      const occurrenceDate = new Date(weekStart);
      occurrenceDate.setDate(weekStart.getDate() + week * 7 + weekday);
      occurrenceDate.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
      const occurrence = occurrenceDate.getTime();
      if (occurrence < event.startMs) continue;
      if (untilMs && occurrence > untilMs) continue;
      emitted += 1;
      if (count && emitted > count) return meetings;
      if (occurrence >= lowerBound && occurrence <= upperBound) {
        pushMeeting(meetings, event, occurrence, durationMs, joinUrl);
      }
    }
    if (weekStart.getTime() + week * 7 * 24 * 60 * 60 * 1000 > upperBound) break;
  }

  return meetings;
}

export function parseIcsZoomMeetings(raw: string, nowMs = Date.now(), horizonMs = 12 * 60 * 60 * 1000): CalendarMeeting[] {
  const meetings: CalendarMeeting[] = [];
  const lines = unfoldIcs(raw);
  let current: Partial<IcsEvent> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT" && current) {
      const event: IcsEvent = {
        uid: current.uid ?? "",
        title: current.title ?? "",
        startMs: current.startMs ?? null,
        endMs: current.endMs ?? null,
        status: current.status ?? "",
        location: current.location ?? "",
        description: current.description ?? "",
        url: current.url ?? "",
        rrule: current.rrule ?? ""
      };
      const joinUrl = extractZoomJoinUrl(`${event.url}\n${event.location}\n${event.description}`);
      if (event.status.toUpperCase() !== "CANCELLED" && event.startMs && event.endMs && joinUrl) {
        if (event.rrule) {
          meetings.push(...expandRecurringEvent(event, nowMs, horizonMs, joinUrl));
        } else if (event.startMs >= nowMs - 5 * 60 * 1000 && event.startMs <= nowMs + horizonMs) {
          pushMeeting(meetings, event, event.startMs, Math.max(0, event.endMs - event.startMs), joinUrl);
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const name = propertyName(line);
    const value = propertyValue(line);
    if (name === "UID") current.uid = unescapeIcsText(value);
    if (name === "SUMMARY") current.title = unescapeIcsText(value);
    if (name === "DTSTART") current.startMs = parseIcsDate(value);
    if (name === "DTEND") current.endMs = parseIcsDate(value);
    if (name === "STATUS") current.status = value;
    if (name === "LOCATION") current.location = unescapeIcsText(value);
    if (name === "DESCRIPTION") current.description = unescapeIcsText(value);
    if (name === "URL") current.url = unescapeIcsText(value);
    if (name === "RRULE") current.rrule = value;
  }

  return meetings.sort((left, right) => left.startMs - right.startMs);
}
