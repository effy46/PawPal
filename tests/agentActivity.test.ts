import assert from "node:assert/strict";
import { filterArchivedAgentSessions } from "../src/shared/agentActivity";
import type { CodexActivitySession } from "../src/shared/types";

function session(id: string, state: CodexActivitySession["state"]): CodexActivitySession {
  return {
    id,
    title: id,
    state,
    message: null,
    updatedAt: 1,
    path: `/tmp/${id}.jsonl`
  };
}

export const tests = [
  {
    name: "filterArchivedAgentSessions removes archived sessions only",
    run(): void {
      const sessions = [session("active", "working"), session("done", "complete"), session("archived", "complete")];
      assert.deepEqual(
        filterArchivedAgentSessions(sessions, new Set(["archived"])).map((item) => item.id),
        ["active", "done"]
      );
    }
  }
];
