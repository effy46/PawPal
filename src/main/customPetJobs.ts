import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PET_STATE_ORDER } from "../shared/petAppearances";
import type { PetState } from "../shared/types";

export type CustomPetJobStatus = "queued" | "running" | "needs_input" | "complete" | "error";
export type CustomPetJobStateStatus = CustomPetJobStatus;

export type CustomPetJobState = {
  state: PetState;
  status: CustomPetJobStateStatus;
  sourcePath: string | null;
  sourceRelativePath?: string;
  normalizedRelativePath?: string;
  updatedAt: number | null;
  error: string | null;
};

export type CustomPetJobSummary = {
  totalStates: number;
  queuedStates: number;
  runningStates: number;
  needsInputStates: number;
  completeStates: number;
  errorStates: number;
};

export type CustomPetJobActions = {
  canResume: boolean;
  threadId: string | null;
  promptPath: string;
  cwd: string;
  openCodexInstructions: string;
  copyCliFallbackText: string;
};

export type CustomPetGenerationJob = {
  schemaVersion: 1;
  id: string;
  petId: string;
  displayName: string;
  status: CustomPetJobStatus;
  threadId: string | null;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  jobPath: string;
  promptPath: string;
  sourceDir: string;
  states: CustomPetJobState[];
  summary: CustomPetJobSummary;
  actions: CustomPetJobActions;
};

export type CreateCustomPetJobOptions = {
  customPetsRoot: string;
  petId: string;
  displayName: string;
  prompt: string;
  cwd?: string;
  now?: number;
};

export type CustomPetJobActionInput = {
  threadId: string | null;
  promptPath?: string;
  cwd?: string;
};

const SAFE_PET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanSingleLine(value: string, fallback: string): string {
  const cleaned = value.replace(/\0/g, "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function cleanPrompt(value: string): string {
  const cleaned = value.replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();
  if (!cleaned) throw new Error("Prompt required");
  return `${cleaned}\n`;
}

function assertSafePetId(petId: string): void {
  if (!SAFE_PET_ID.test(petId)) throw new Error("Invalid pet id");
}

function assertInside(root: string, child: string): void {
  const childRelativePath = relative(resolve(root), resolve(child));
  const isInside = childRelativePath === "" || (!childRelativePath.startsWith("..") && !isAbsolute(childRelativePath));
  if (!isInside) throw new Error("Invalid pet path");
}

async function writeFileAtomic(path: string, contents: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, path);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function getCustomPetJobActions(input: CustomPetJobActionInput): CustomPetJobActions {
  const threadId = typeof input.threadId === "string" ? input.threadId : null;
  const promptPath = input.promptPath ?? "";
  const cwd = input.cwd ?? "";
  const canResume = Boolean(threadId && UUID.test(threadId));
  return {
    canResume,
    threadId,
    promptPath,
    cwd,
    openCodexInstructions: [
      "Open Codex manually.",
      `Working directory: ${cwd}`,
      `Prompt file: ${promptPath}`,
      "Use the prompt file contents to continue this custom pet generation job."
    ].join("\n"),
    copyCliFallbackText: `cd ${shellQuote(cwd)}\ncodex exec - < ${shellQuote(promptPath)}`
  };
}

function summarize(states: CustomPetJobState[]): CustomPetJobSummary {
  return {
    totalStates: states.length,
    queuedStates: states.filter((state) => state.status === "queued").length,
    runningStates: states.filter((state) => state.status === "running").length,
    needsInputStates: states.filter((state) => state.status === "needs_input").length,
    completeStates: states.filter((state) => state.status === "complete").length,
    errorStates: states.filter((state) => state.status === "error").length
  };
}

function createQueuedStates(): CustomPetJobState[] {
  return PET_STATE_ORDER.map((state) => ({
    state,
    status: "queued",
    sourcePath: null,
    updatedAt: null,
    error: null
  }));
}

function reconcileJobStatus(
  previousStatus: CustomPetJobStatus,
  summary: CustomPetJobSummary
): CustomPetJobStatus {
  if (summary.completeStates === summary.totalStates) return "complete";
  if (summary.errorStates > 0) return "error";
  if (summary.needsInputStates > 0) return "needs_input";
  if (summary.completeStates > 0) return "running";
  if (previousStatus === "error" || previousStatus === "needs_input" || previousStatus === "running") {
    return previousStatus;
  }
  return "needs_input";
}

export async function createCustomPetJob(options: CreateCustomPetJobOptions): Promise<CustomPetGenerationJob> {
  assertSafePetId(options.petId);

  const customPetsRoot = resolve(options.customPetsRoot);
  const petDir = resolve(customPetsRoot, options.petId);
  assertInside(customPetsRoot, petDir);

  const now = options.now ?? Date.now();
  const promptPath = join(petDir, "prompt.md");
  const jobPath = join(petDir, "job.json");
  const sourceDir = join(petDir, "source");
  const states = createQueuedStates();
  const cwd = options.cwd ?? process.cwd();
  const threadId = null;

  const job: CustomPetGenerationJob = {
    schemaVersion: 1,
    id: randomUUID(),
    petId: options.petId,
    displayName: cleanSingleLine(options.displayName, "Custom Pet"),
    status: "needs_input",
    threadId,
    createdAt: now,
    updatedAt: now,
    cwd,
    jobPath,
    promptPath,
    sourceDir,
    states,
    summary: summarize(states),
    actions: getCustomPetJobActions({ threadId, promptPath, cwd })
  };

  await mkdir(sourceDir, { recursive: true });
  await writeFileAtomic(promptPath, cleanPrompt(options.prompt));
  await writeFileAtomic(jobPath, `${JSON.stringify(job, null, 2)}\n`);
  return job;
}

function isPetState(value: string): value is PetState {
  return PET_STATE_ORDER.includes(value as PetState);
}

async function sourceGifMap(sourceDir: string): Promise<Map<PetState, string>> {
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch(() => []);
  const files = new Map<PetState, string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".gif")) continue;
    const state = basename(entry.name, ".gif");
    if (isPetState(state)) files.set(state, join(sourceDir, entry.name));
  }
  return files;
}

export async function reconcileCustomPetJob(jobPath: string, now = Date.now()): Promise<CustomPetGenerationJob> {
  const job = JSON.parse(await readFile(jobPath, "utf8")) as CustomPetGenerationJob;
  const sourceFiles = await sourceGifMap(job.sourceDir);
  const states = job.states.map((state) => {
    const sourcePath = sourceFiles.get(state.state);
    if (!sourcePath) return state;
    return {
      ...state,
      status: "complete" as const,
      sourcePath,
      updatedAt: state.status === "complete" ? state.updatedAt : now,
      error: null
    };
  });
  const summary = summarize(states);
  const next: CustomPetGenerationJob = {
    ...job,
    status: reconcileJobStatus(job.status, summary),
    updatedAt: now,
    states,
    summary,
    actions: getCustomPetJobActions({
      threadId: job.threadId,
      promptPath: job.promptPath,
      cwd: job.cwd
    })
  };

  await writeFileAtomic(jobPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
