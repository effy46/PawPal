import type { CodexActivitySession } from "./types";

export function filterArchivedAgentSessions(
  sessions: CodexActivitySession[],
  archivedIds: ReadonlySet<string>
): CodexActivitySession[] {
  if (!archivedIds.size) return sessions;
  return sessions.filter((session) => !archivedIds.has(session.id));
}
