import { basename, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { copyFile, mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  screen,
  shell,
  Tray
} from "electron";
import Store from "electron-store";
import {
  createEmptyStats,
  DEFAULT_SETTINGS
} from "../shared/constants";
import { i18n, pick } from "../shared/i18n";
import { PET_STATE_ORDER } from "../shared/petAppearances";
import type {
  AppSnapshot,
  BlockingMode,
  CodexActivity,
  CodexActivitySession,
  CodexActivityState,
  AgentActivityProvider,
  CustomPetAsset,
  DistractionStatus,
  DemoTrigger,
  PetFacing,
  PetState,
  Settings,
  StatsHistory,
  SpeechBubble,
  TodayStats,
  UpdateCheckResult
} from "../shared/types";
import {
  APP_NAME,
  BREAK_RUN_TICK_MS,
  DISTRACTION_CHECK_INTERVAL_MS,
  DISTRACTION_WARNING_COOLDOWN_MS,
  IS_DEV,
  PET_SCALE,
  PET_WINDOW,
  PET_WINDOW_TRANSPARENT_SIDE_GAP,
  PRELOAD_PATH,
  RELEASES_URL,
  RENDERER_HTML_PATH,
  SETTINGS_WINDOW,
  STORE_NAME
} from "./config";
import {
  horizontalRunTarget,
  initialWindowBounds,
  savedPositionFromBounds,
  visibleWindowBounds
} from "./displayPosition";
import type { DisplayBounds, SavedWindowPosition } from "./displayPosition";
import { classifyDistraction, isPermissionError, readActiveWindow } from "./distraction";
import { applyLaunchAtLoginPreference, getLaunchAtLoginState } from "./loginItem";
import {
  buildApplicationMenuTemplate,
  buildPetContextMenuTemplate,
  buildTrayMenuTemplate
} from "./menus";
import { createTrayImage } from "./trayIcon";
import { getStoredSettings, normalizeSettings } from "./settingsStore";
import {
  getCurrentStats,
  getStatsHistory,
  resetCurrentStats,
  updateCurrentStats
} from "./statsStore";
import {
  checkGitHubReleasesForUpdates,
  createCheckingUpdateCheck,
  createInitialUpdateCheck
} from "./updates";

type StoreSchema = {
  settings: Settings;
  stats: TodayStats;
  statsHistory: StatsHistory;
  petPosition?: SavedWindowPosition;
  petScale?: number;
};

type SettingsCopy = ReturnType<typeof i18n>["settings"];

type PetPosition = {
  x: number;
  y: number;
};

app.setName(APP_NAME);

const store = new Store<StoreSchema>({
  name: STORE_NAME,
  defaults: {
    settings: DEFAULT_SETTINGS,
    stats: createEmptyStats(),
    statsHistory: {}
  }
});

let petWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let petState: PetState = "idle";
let petFacing: PetFacing = "right";
let blockingMode: BlockingMode = null;
let focusActive = false;
let focusStartedAt: number | null = null;
let breakRunTimer: NodeJS.Timeout | null = null;
let breakRunCountdownTimer: NodeJS.Timeout | null = null;
let breakRunMovementTimer: NodeJS.Timeout | null = null;
let breakTimer: NodeJS.Timeout | null = null;
let hydrationTimer: NodeJS.Timeout | null = null;
let focusTimer: NodeJS.Timeout | null = null;
let distractionTimer: NodeJS.Timeout | null = null;
let distractionStartupTimer: NodeJS.Timeout | null = null;
let displayChangeTimer: NodeJS.Timeout | null = null;
let codexActivityTimer: NodeJS.Timeout | null = null;
let breakDueAt: number | null = null;
let hydrationDueAt: number | null = null;
let focusEndsAt: number | null = null;
let bubbleTimer: NodeJS.Timeout | null = null;
let dragTimer: NodeJS.Timeout | null = null;
let dragSafetyTimer: NodeJS.Timeout | null = null;
let resizeTimer: NodeJS.Timeout | null = null;
let resizeSafetyTimer: NodeJS.Timeout | null = null;
let quitAnimationTimer: NodeJS.Timeout | null = null;
let breakRunVelocity: PetPosition = { x: 0, y: 0 };
let breakRunFormatter: ((seconds: number) => string) | null = null;
let nextBreakRunTurnAt = 0;
let breakMutedToday = false;
let dragOffset: PetPosition = { x: 0, y: 0 };
let petScale = normalizePetScale(store.get("petScale"));
let petMouseInteractive = true;
let quitAnimationRunning = false;
let quitAfterAnimation = false;
let distractionStatus: DistractionStatus = {
  state: "idle",
  activeApp: "",
  activeWindowTitle: "",
  matchedRule: null,
  lastCheckedAt: null,
  lastWarningAt: null,
  error: null
};
let updateCheck: UpdateCheckResult = createInitialUpdateCheck();

type PetResizeSession = {
  startCursor: PetPosition;
  startBounds: Electron.Rectangle;
  startScale: number;
};

let petResizeSession: PetResizeSession | null = null;

function normalizePetScale(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : PET_SCALE.default;
  return Math.min(Math.max(numeric, PET_SCALE.min), PET_SCALE.max);
}

function petWindowSize(scale = petScale): { width: number; height: number } {
  return {
    width: Math.round(PET_WINDOW.width * scale),
    height: Math.round(PET_WINDOW.height * scale)
  };
}

function petDragOverflow(scale = petScale): { left: number; right: number } {
  const x = Math.round(PET_WINDOW_TRANSPARENT_SIDE_GAP * scale);
  return { left: x, right: x };
}

function codexActivityPath(): string {
  return join(app.getPath("home"), ".codex", "pawpal", "activity.json");
}

function codexActivityDirectory(): string {
  return join(app.getPath("home"), ".codex", "pawpal");
}

function codexSessionsRoot(): string {
  return join(app.getPath("home"), ".codex", "sessions");
}

function codexSessionIndexPath(): string {
  return join(app.getPath("home"), ".codex", "session_index.jsonl");
}

function claudeProjectsRoot(): string {
  return join(app.getPath("home"), ".claude", "projects");
}

function claudeCodeSessionsRoot(): string {
  return join(app.getPath("appData"), "Claude", "claude-code-sessions");
}

function codexSessionSearchRoots(): string[] {
  return Array.from({ length: 7 }, (_unused, offset) => {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
    return join(
      codexSessionsRoot(),
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    );
  });
}

let codexActivity: CodexActivity = {
  state: "idle",
  message: null,
  updatedAt: null,
  path: codexActivityPath(),
  provider: "codex",
  source: "manual",
  sessions: []
};

const CODEX_SESSION_TAIL_BYTES = 256 * 1024;
const CODEX_SESSION_ACTIVE_STALE_MS = 10 * 60 * 1000;
const CODEX_SESSION_ACTIVE_WINDOW_MS = 60 * 1000;
const CODEX_SESSION_READY_WINDOW_MS = 60 * 1000;
const CODEX_SESSION_POLL_MS = 1000;
const CODEX_THREAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CodexSessionEvent = {
  timestamp?: string;
  type?: string;
  payload?: {
    id?: string;
    type?: string;
    isCompleted?: boolean;
    name?: string;
    arguments?: string;
    call_id?: string;
    role?: string;
    message?: string;
    last_agent_message?: string;
    output?: string;
    cwd?: string;
    turn_id?: string;
  };
};

type CodexToolActivity =
  | { type: "readFile"; fileName: string }
  | { type: "listFiles" }
  | { type: "searchFiles"; query: string | null }
  | { type: "editFiles"; fileCount: number }
  | { type: "webSearch"; query: string | null }
  | { type: "toolCall"; toolName: string | null }
  | { type: "command" };

type ClaudeContentBlock = {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
};

type ClaudeSessionEvent = {
  type?: string;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  summary?: string;
  title?: string;
  name?: string;
  lastPrompt?: string;
  message?: {
    role?: string;
    content?: string | ClaudeContentBlock[];
  };
};

type ClaudeCodeSessionMetadata = {
  cliSessionId?: string;
  title?: string;
  lastActivityAt?: number;
};

function codexActivityFreshMs(state: CodexActivityState): number {
  return state === "complete" ? CODEX_SESSION_READY_WINDOW_MS : CODEX_SESSION_ACTIVE_WINDOW_MS;
}

function setPetMouseInteractive(interactive: boolean): void {
  if (!petWindow || petWindow.isDestroyed() || petMouseInteractive === interactive) return;
  petMouseInteractive = interactive;
  petWindow.setIgnoreMouseEvents(!interactive, { forward: true });
}

function clearRuntimeTimers(): void {
  for (const timer of [
    breakRunTimer,
    breakRunCountdownTimer,
    breakRunMovementTimer,
    breakTimer,
    hydrationTimer,
    focusTimer,
    distractionTimer,
    distractionStartupTimer,
    displayChangeTimer,
    codexActivityTimer,
    bubbleTimer,
    dragTimer,
    dragSafetyTimer,
    resizeTimer,
    resizeSafetyTimer
  ]) {
    if (timer) clearTimeout(timer);
  }
  breakRunTimer = null;
  breakRunCountdownTimer = null;
  breakRunMovementTimer = null;
  breakTimer = null;
  hydrationTimer = null;
  focusTimer = null;
  distractionTimer = null;
  distractionStartupTimer = null;
  displayChangeTimer = null;
  codexActivityTimer = null;
  bubbleTimer = null;
  dragTimer = null;
  dragSafetyTimer = null;
  resizeTimer = null;
  resizeSafetyTimer = null;
}

function getSettings(): Settings {
  return getStoredSettings(store);
}

function text(): ReturnType<typeof i18n> {
  return i18n(getSettings().language);
}

function agentActivityProviderForPet(): AgentActivityProvider | null {
  const appearanceId = getSettings().petAppearanceId;
  if (appearanceId === "lineDog") return "codex";
  if (appearanceId === "xiaoJiMao") return "claude";
  return null;
}

function emptyAgentActivity(provider: AgentActivityProvider = "codex"): CodexActivity {
  return {
    state: "idle",
    message: null,
    updatedAt: null,
    path: provider === "claude" ? claudeProjectsRoot() : codexActivityPath(),
    provider,
    source: "manual",
    sessions: []
  };
}

function setSettings(next: Settings): void {
  const normalized = normalizeSettings(next);
  applyLaunchAtLoginPreference(normalized.launchAtLoginEnabled);
  store.set("settings", normalized);
  sendToAll("settings:updated", getSettingsWithSystemState());
  settingsWindow?.setTitle(`${APP_NAME} ${text().menu.settings}`);
  scheduleReminderTimers();
  scheduleDistractionDetection();
  updateTrayMenu();
  void pollCodexActivity();
}

function getSettingsWithSystemState(): Settings {
  const settings = getSettings();
  return {
    ...settings,
    launchAtLoginEnabled: getLaunchAtLoginState(settings.launchAtLoginEnabled)
  };
}

function getStats(): TodayStats {
  return getCurrentStats(store);
}

function updateStats(mutator: (stats: TodayStats) => TodayStats): void {
  const next = updateCurrentStats(store, mutator);
  sendToAll("stats:updated", next);
}

function isCustomPetState(state: unknown): state is PetState {
  return typeof state === "string" && PET_STATE_ORDER.includes(state as PetState);
}

async function importCustomPetAsset(state: PetState, sourcePath: string): Promise<CustomPetAsset | null> {
  if (!isCustomPetState(state) || typeof sourcePath !== "string") return null;
  if (extname(sourcePath).toLowerCase() !== ".gif") return null;

  const customRoot = join(app.getPath("userData"), "custom_pet_assets");
  const stateDir = join(customRoot, state);
  await mkdir(stateDir, { recursive: true });

  const originalName = basename(sourcePath);
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]+/g, "-") || `${state}.gif`;
  const fileName = `${state}-${Date.now()}-${safeName}`;
  const targetPath = join(stateDir, fileName);
  await copyFile(sourcePath, targetPath);

  return {
    relativePath: `custom_pet_assets/${state}/${fileName}`,
    originalName,
    updatedAt: Date.now()
  };
}

function resetTodayStats(): void {
  breakMutedToday = false;
  const reset = resetCurrentStats(store);
  sendToAll("stats:updated", reset);
}

async function selectCustomPetAsset(state: PetState): Promise<CustomPetAsset | null> {
  if (!isCustomPetState(state)) return null;

  const options: Electron.OpenDialogOptions = {
    properties: ["openFile"],
    filters: [{ name: "GIF Images", extensions: ["gif"] }]
  };
  const result =
    settingsWindow && !settingsWindow.isDestroyed()
      ? await dialog.showOpenDialog(settingsWindow, options)
      : await dialog.showOpenDialog(options);

  if (result.canceled || !result.filePaths[0]) return null;
  return importCustomPetAsset(state, result.filePaths[0]);
}

function snapshot(): AppSnapshot {
  return {
    appInfo: {
      version: app.getVersion(),
      releaseNotesUrl: RELEASES_URL
    },
    updateCheck,
    settings: getSettingsWithSystemState(),
    stats: getStats(),
    statsHistory: getStatsHistory(store),
    timers: {
      breakDueAt,
      hydrationDueAt,
      focusEndsAt
    },
    distraction: distractionStatus,
    petState,
    petFacing,
    petScale,
    codexActivity,
    blockingMode,
    dogVisible: Boolean(petWindow?.isVisible()),
    focusActive
  };
}

function sendToPet<T>(channel: string, payload?: T): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send(channel, payload);
}

function sendToAll<T>(channel: string, payload?: T): void {
  sendToPet(channel, payload);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, payload);
  }
}

function publishSnapshot(): void {
  sendToAll("app:snapshot", snapshot());
}

function setPetState(next: PetState): void {
  petState = next;
  sendToAll("pet:set-state", next);
}

function isCodexActivityState(value: unknown): value is CodexActivityState {
  return (
    value === "idle" ||
    value === "working" ||
    value === "reviewing" ||
    value === "complete" ||
    value === "waiting" ||
    value === "error"
  );
}

function normalizeCodexActivity(value: unknown): CodexActivity {
  const path = codexActivityPath();
  if (!value || typeof value !== "object") {
    return { state: "idle", message: null, updatedAt: null, path, provider: "codex", source: "manual", sessions: [] };
  }
  const source = value as Partial<CodexActivity>;
  const state = isCodexActivityState(source.state) ? source.state : "idle";
  const provider = source.provider === "claude" ? "claude" : "codex";
  const activitySource =
    source.source === "codex-session" || source.source === "claude-session" ? source.source : "manual";
  const sessions = Array.isArray(source.sessions)
    ? source.sessions
        .filter((session): session is CodexActivitySession => {
          if (!session || typeof session !== "object") return false;
          const candidate = session as Partial<CodexActivitySession>;
          return (
            typeof candidate.id === "string" &&
            typeof candidate.title === "string" &&
            isCodexActivityState(candidate.state) &&
            typeof candidate.updatedAt === "number" &&
            typeof candidate.path === "string"
          );
        })
        .slice(0, 5)
    : [];
  return {
    state,
    message: typeof source.message === "string" && source.message.trim() ? source.message.trim() : null,
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : Date.now(),
    path,
    provider,
    source: activitySource,
    sessions
  };
}

function setCodexActivity(next: CodexActivity): void {
  const changed =
    codexActivity.state !== next.state ||
    codexActivity.message !== next.message ||
    codexActivity.updatedAt !== next.updatedAt ||
    codexActivity.path !== next.path ||
    codexActivity.provider !== next.provider ||
    codexActivity.source !== next.source ||
    JSON.stringify(codexActivity.sessions) !== JSON.stringify(next.sessions);
  if (!changed) return;
  codexActivity = next;
  publishSnapshot();
}

async function readStoredCodexActivity(): Promise<CodexActivity | null> {
  try {
    const raw = await readFile(codexActivityPath(), "utf8");
    return normalizeCodexActivity(JSON.parse(raw));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "ENOENT") return null;
    return {
      state: "error",
      message: error instanceof Error ? error.message : String(error),
      updatedAt: Date.now(),
      path: codexActivityPath(),
      provider: "codex",
      source: "manual",
      sessions: []
    };
  }
}

async function writeCodexActivityFile(activity: CodexActivity): Promise<void> {
  const { path: _path, ...payload } = activity;
  await mkdir(codexActivityDirectory(), { recursive: true });
  await writeFile(codexActivityPath(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeCodexActivityDemo(state: CodexActivityState, message: string | null): Promise<void> {
  const next: CodexActivity = {
    state,
    message,
    updatedAt: Date.now(),
    path: codexActivityPath(),
    provider: agentActivityProviderForPet() ?? "codex",
    source: "manual",
    sessions: []
  };
  await writeCodexActivityFile(next);
  setCodexActivity(next);
}

async function findLatestCodexSessionFile(directory: string): Promise<{ path: string; mtimeMs: number } | null> {
  let latest: { path: string; mtimeMs: number } | null = null;
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nestedLatest = await findLatestCodexSessionFile(entryPath);
      if (nestedLatest && (!latest || nestedLatest.mtimeMs > latest.mtimeMs)) {
        latest = nestedLatest;
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const entryStat = await stat(entryPath);
    if (!latest || entryStat.mtimeMs > latest.mtimeMs) {
      latest = { path: entryPath, mtimeMs: entryStat.mtimeMs };
    }
  }

  return latest;
}

async function findCodexSessionFiles(directory: string): Promise<Array<{ path: string; mtimeMs: number }>> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: Array<{ path: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findCodexSessionFiles(entryPath)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const entryStat = await stat(entryPath);
    files.push({ path: entryPath, mtimeMs: entryStat.mtimeMs });
  }
  return files;
}

async function findJsonFiles(directory: string): Promise<Array<{ path: string; mtimeMs: number }>> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: Array<{ path: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findJsonFiles(entryPath)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const entryStat = await stat(entryPath);
      files.push({ path: entryPath, mtimeMs: entryStat.mtimeMs });
    } catch {
      // Session metadata can disappear while Claude is updating it.
    }
  }
  return files;
}

async function readFileTail(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const fileStat = await handle.stat();
    const length = Math.min(fileStat.size, maxBytes);
    const position = Math.max(0, fileStat.size - length);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, position);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readFileHead(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const fileStat = await handle.stat();
    const length = Math.min(fileStat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readCodexSessionTitles(): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  try {
    const raw = await readFile(codexSessionIndexPath(), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as { id?: unknown; thread_name?: unknown };
        if (typeof record.id === "string" && typeof record.thread_name === "string") {
          titles.set(record.id, record.thread_name);
        }
      } catch {
        // Ignore partial/corrupt index lines.
      }
    }
  } catch {
    return titles;
  }
  return titles;
}

function parseCodexSessionEvents(raw: string): CodexSessionEvent[] {
  const events: CodexSessionEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as CodexSessionEvent);
    } catch {
      // Ignore a partial first line from tail reads.
    }
  }
  return events;
}

function parseCodexToolArguments(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  return null;
}

function compactCodexText(value: string | null, maxLength = 48): string | null {
  const compact = value?.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}...`;
}

function shellTokens(command: string): string[] {
  return command
    .match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+/g)
    ?.map((token) => token.replace(/^["']|["']$/g, ""))
    .filter(Boolean) ?? [];
}

function basenameFromToken(token: string | null): string | null {
  if (!token) return null;
  const clean = token.replace(/[),;]+$/g, "");
  if (!clean || clean.startsWith("-") || /^[0-9,]+[a-z]?$/i.test(clean)) return null;
  const name = basename(clean);
  return compactCodexText(name);
}

function fileNameFromShellTokens(tokens: string[]): string | null {
  for (let index = tokens.length - 1; index >= 1; index -= 1) {
    const token = tokens[index];
    if (token === "|" || token === "&&" || token === "||") break;
    const name = basenameFromToken(token);
    if (name) return name;
  }
  return null;
}

function searchQueryFromShellTokens(tokens: string[]): string | null {
  const command = basename(tokens[0] ?? "");
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token === "|" || token === "&&" || token === "||") break;
    if (token.startsWith("-")) continue;
    if ((command === "rg" || command === "grep") && tokens[index - 1]?.startsWith("--glob")) continue;
    return compactCodexText(token);
  }
  return null;
}

function classifyShellCommand(command: string): CodexToolActivity {
  const tokens = shellTokens(command);
  const executable = basename(tokens[0] ?? "");
  if (!executable) return { type: "command" };

  if (executable === "rg" && tokens.includes("--files")) return { type: "listFiles" };
  if (["ls", "find", "fd", "tree"].includes(executable)) return { type: "listFiles" };
  if (["rg", "grep", "ag", "ack"].includes(executable)) {
    return { type: "searchFiles", query: searchQueryFromShellTokens(tokens) };
  }
  if (["cat", "sed", "nl", "head", "tail", "less", "more"].includes(executable)) {
    const fileName = fileNameFromShellTokens(tokens);
    if (fileName) return { type: "readFile", fileName };
  }

  return { type: "command" };
}

function countPatchFiles(patch: string): number {
  const matches = patch.match(/^\*\*\* (?:Add|Update|Delete) File: /gm);
  return Math.max(1, matches?.length ?? 0);
}

function toolNameForDisplay(name: string | undefined): string | null {
  if (!name) return null;
  const compact = name
    .replace(/^functions\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return compactCodexText(compact);
}

function classifyCodexFunctionCall(event: CodexSessionEvent): CodexToolActivity | null {
  const payload = event.payload;
  if (payload?.type !== "function_call") return null;

  const args = parseCodexToolArguments(payload.arguments);
  const name = payload.name;

  if (name === "exec_command") {
    const command = typeof args.cmd === "string" ? args.cmd : null;
    return command ? classifyShellCommand(command) : { type: "command" };
  }

  if (name === "apply_patch") return { type: "editFiles", fileCount: countPatchFiles(payload.arguments ?? "") };

  if (name === "web.run" || name === "web_run" || name === "search_query" || name === "image_query") {
    return { type: "webSearch", query: compactCodexText(firstString(args.search_query ?? args.image_query ?? args.q)) };
  }

  if (args.search_query || args.image_query) {
    return { type: "webSearch", query: compactCodexText(firstString(args.search_query ?? args.image_query)) };
  }

  return { type: "toolCall", toolName: toolNameForDisplay(name) };
}

function functionCallForOutput(events: CodexSessionEvent[], outputIndex: number): CodexSessionEvent | null {
  const callId = events[outputIndex]?.payload?.call_id;
  for (let index = outputIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.payload?.type !== "function_call") continue;
    if (callId && event.payload.call_id !== callId) continue;
    return event;
  }
  return null;
}

function messageForCodexToolActivity(
  activity: CodexToolActivity,
  labels: SettingsCopy,
  running: boolean
): string {
  switch (activity.type) {
    case "readFile":
      return running ? labels.codexReadingFile(activity.fileName) : labels.codexReadFile(activity.fileName);
    case "listFiles":
      return running ? labels.codexListingFiles : labels.codexListedFiles;
    case "searchFiles":
      if (activity.query) {
        return running ? labels.codexSearchingQuery(activity.query) : labels.codexSearchedQuery(activity.query);
      }
      return running ? labels.codexSearchingFiles : labels.codexSearchedFiles;
    case "editFiles":
      return running ? labels.codexEditingFiles(activity.fileCount) : labels.codexEditedFiles(activity.fileCount);
    case "webSearch":
      if (activity.query) {
        return running ? labels.codexSearchingQuery(activity.query) : labels.codexSearchedQuery(activity.query);
      }
      return running ? labels.codexSearchingWeb : labels.codexSearchedWeb;
    case "toolCall":
      return running ? labels.codexCallingTool(activity.toolName) : labels.codexCalledTool(activity.toolName);
    case "command":
      return running ? labels.codexRunningCommand : labels.codexRanCommand;
  }
}

function messageForCodexSessionEvent(
  event: CodexSessionEvent,
  labels: SettingsCopy,
  events: CodexSessionEvent[] = [],
  eventIndex = -1
): string | null {
  const payload = event.payload;
  if (!payload) return null;
  if (payload.type === "planImplementation" && payload.isCompleted !== true) return labels.codexPlanReady;
  if (payload.type === "function_call" && payload.name === "request_user_input") {
    return labels.codexNeedsReply;
  }
  if (payload.type === "function_call") {
    const activity = classifyCodexFunctionCall(event);
    return activity ? messageForCodexToolActivity(activity, labels, true) : labels.codexRunningTool(payload.name ?? null);
  }
  if (payload.type === "function_call_output") {
    const call = functionCallForOutput(events, eventIndex);
    const activity = call ? classifyCodexFunctionCall(call) : null;
    return activity ? messageForCodexToolActivity(activity, labels, false) : labels.codexReviewingToolOutput;
  }
  if (payload.type === "agent_message") return labels.codexWritingResponse;
  if (payload.type === "user_message") return labels.codexReadingPrompt;
  if (payload.type === "task_started") return labels.codexWorkingMessage;
  if (payload.type === "task_complete") return labels.codexWaitingForNextPrompt;
  if (payload.type === "reasoning") return labels.codexWorking;
  if (payload.type === "message" && payload.role === "assistant") return labels.codexWritingResponse;
  return null;
}

function messageNeedsReply(message: string | null | undefined): boolean {
  if (!message) return false;
  return /(\?|please|could you|can you|do you want|would you|which|what|how|send|share|confirm|approve|pick|choose|let me know|need your|waiting for you)/i.test(
    message
  );
}

function stateForCodexSessionEvent(event: CodexSessionEvent): CodexActivityState | null {
  const payload = event.payload;
  if (!payload) return null;
  if (payload.type === "planImplementation" && payload.isCompleted !== true) return "waiting";
  if (payload.type === "function_call" && payload.name === "request_user_input") return "waiting";
  if (payload.type === "task_started" || payload.type === "user_message" || payload.type === "reasoning") {
    return "working";
  }
  if (payload.type === "function_call") return "working";
  if (payload.type === "function_call_output") {
    if (/Process exited with code [1-9]/.test(payload.output ?? "")) return "error";
    return "reviewing";
  }
  if (payload.type === "agent_message") return "reviewing";
  if (payload.type === "message" && payload.role === "assistant") return "reviewing";
  if (payload.type === "task_complete") return "complete";
  return null;
}

function titleForCodexSession(
  events: CodexSessionEvent[],
  filePath: string,
  sessionId: string,
  titleMap: Map<string, string>
): string {
  const indexedTitle = titleMap.get(sessionId);
  if (indexedTitle) return indexedTitle;

  for (let index = 0; index < events.length; index += 1) {
    const payload = events[index].payload;
    if (payload?.type !== "user_message") continue;
    const message = payload.message?.replace(/\s+/g, " ").trim();
    if (message) return message.length > 48 ? `${message.slice(0, 45)}...` : message;
  }

  for (const event of events) {
    const cwd = event.payload?.cwd?.trim();
    if (cwd) return basename(cwd);
  }

  return basename(filePath, extname(filePath));
}

function idForCodexSession(events: CodexSessionEvent[], filePath: string): string {
  const meta = events.find((event) => event.type === "session_meta" && event.payload?.id);
  return meta?.payload?.id ?? basename(filePath, extname(filePath));
}

async function inferCodexSessionFileActivity(file: {
  path: string;
  mtimeMs: number;
}, titleMap: Map<string, string>): Promise<CodexActivitySession | null> {
  const labels = text().settings;
  const [head, tail] = await Promise.all([
    readFileHead(file.path, 64 * 1024),
    readFileTail(file.path, CODEX_SESSION_TAIL_BYTES)
  ]);
  const raw = `${head}\n${tail}`;
  const events = parseCodexSessionEvents(raw);

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const state = stateForCodexSessionEvent(event);
    if (!state) continue;

    const updatedAt = event.timestamp ? Date.parse(event.timestamp) : file.mtimeMs;
    if (!Number.isFinite(updatedAt)) return null;

    if (Date.now() - updatedAt > codexActivityFreshMs(state)) return null;

    const id = idForCodexSession(events, file.path);
    return {
      id,
      title: titleForCodexSession(events, file.path, id, titleMap),
      state,
      message: messageForCodexSessionEvent(event, labels, events, index),
      updatedAt,
      path: file.path
    };
  }

  return null;
}

function aggregateSessionActivity(
  sessions: CodexActivitySession[],
  labels: SettingsCopy,
  provider: AgentActivityProvider,
  source: "codex-session" | "claude-session"
): CodexActivity {
  const path = provider === "claude" ? claudeProjectsRoot() : codexActivityPath();
  const waiting = sessions.filter((session) => session.state === "waiting");
  const visibleSessions = [...sessions]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 5);
  const topWaiting = waiting.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (topWaiting) {
    return {
      state: "waiting",
      message:
        waiting.length === 1
          ? labels.codexReplyNeeded(topWaiting.title)
          : labels.codexChatsNeedReply(waiting.length),
      updatedAt: topWaiting.updatedAt,
      path,
      provider,
      source,
      sessions: visibleSessions
    };
  }

  const topError = visibleSessions.find((session) => session.state === "error");
  if (topError) {
    return {
      state: "error",
      message: labels.codexBlockedMessage(topError.title),
      updatedAt: topError.updatedAt,
      path,
      provider,
      source,
      sessions: visibleSessions
    };
  }

  const activeSessions = visibleSessions.filter(
    (session) => session.state === "working" || session.state === "reviewing"
  );
  const topActive = activeSessions[0];
  if (topActive) {
    return {
      state: topActive.state,
      message:
        activeSessions.length === 1
          ? topActive.message
            ? `${topActive.title}: ${topActive.message}`
            : topActive.title
          : labels.codexChatsActive(activeSessions.length),
      updatedAt: topActive.updatedAt,
      path,
      provider,
      source,
      sessions: visibleSessions
    };
  }

  const latestComplete = visibleSessions.find((session) => session.state === "complete");
  if (latestComplete) {
    return {
      state: "complete",
      message:
        visibleSessions.length === 1
          ? labels.codexReadyMessage(latestComplete.title)
          : labels.codexChatsReady(visibleSessions.length),
      updatedAt: latestComplete.updatedAt,
      path,
      provider,
      source,
      sessions: visibleSessions
    };
  }

  const latest = visibleSessions[0];
  if (latest) {
    return {
      state: latest.state,
      message: latest.message ? `${latest.title}: ${latest.message}` : latest.title,
      updatedAt: latest.updatedAt,
      path,
      provider,
      source,
      sessions: visibleSessions
    };
  }

  return emptyAgentActivity(provider);
}

async function inferCodexSessionActivity(): Promise<CodexActivity | null> {
  const files = (await Promise.all(codexSessionSearchRoots().map(findCodexSessionFiles)))
    .flat()
    .filter((file) => Date.now() - file.mtimeMs <= CODEX_SESSION_ACTIVE_WINDOW_MS)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 50);
  if (!files.length) return null;

  const titleMap = await readCodexSessionTitles();
  const sessions = (await Promise.all(files.map((file) => inferCodexSessionFileActivity(file, titleMap))))
    .filter((session): session is CodexActivitySession => Boolean(session));
  if (!sessions.length) return null;
  return aggregateSessionActivity(sessions, text().settings, "codex", "codex-session");
}

function parseClaudeSessionEvents(raw: string): ClaudeSessionEvent[] {
  const events: ClaudeSessionEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as ClaudeSessionEvent);
    } catch {
      // Ignore a partial first line from tail reads.
    }
  }
  return events;
}

function claudeContentBlocks(event: ClaudeSessionEvent): ClaudeContentBlock[] {
  return Array.isArray(event.message?.content) ? event.message.content : [];
}

function textFromClaudeContent(value: string | ClaudeContentBlock[] | undefined): string | null {
  if (typeof value === "string") return compactCodexText(value);
  if (!Array.isArray(value)) return null;
  const textBlock = value.find((block) => block.type === "text" && typeof block.text === "string");
  return compactCodexText(textBlock?.text ?? null);
}

function classifyClaudeToolUse(block: ClaudeContentBlock): CodexToolActivity {
  const input = block.input ?? {};
  const name = block.name;
  if (name === "Read") return { type: "readFile", fileName: basenameFromToken(firstString(input.file_path) ?? "") ?? "file" };
  if (name === "LS") return { type: "listFiles" };
  if (name === "Glob") return { type: "searchFiles", query: compactCodexText(firstString(input.pattern)) };
  if (name === "Grep") return { type: "searchFiles", query: compactCodexText(firstString(input.pattern)) };
  if (name === "Bash") {
    const command = firstString(input.command);
    return command ? classifyShellCommand(command) : { type: "command" };
  }
  if (name === "Edit" || name === "Write" || name === "NotebookEdit") return { type: "editFiles", fileCount: 1 };
  if (name === "MultiEdit") {
    const edits = input.edits;
    return { type: "editFiles", fileCount: Array.isArray(edits) ? Math.max(1, edits.length) : 1 };
  }
  if (name === "WebFetch") {
    return { type: "webSearch", query: compactCodexText(firstString(input.url) ?? firstString(input.prompt)) };
  }
  if (name === "WebSearch") return { type: "webSearch", query: compactCodexText(firstString(input.query)) };
  return { type: "toolCall", toolName: toolNameForDisplay(name) };
}

function latestClaudeToolUse(events: ClaudeSessionEvent[], outputIndex: number, toolUseId?: string): ClaudeContentBlock | null {
  for (let index = outputIndex - 1; index >= 0; index -= 1) {
    for (const block of claudeContentBlocks(events[index]).slice().reverse()) {
      if (block.type !== "tool_use") continue;
      if (toolUseId && block.id !== toolUseId) continue;
      return block;
    }
  }
  return null;
}

function latestClaudeContentBlock(
  blocks: ClaudeContentBlock[],
  predicate: (block: ClaudeContentBlock) => boolean
): ClaudeContentBlock | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (predicate(blocks[index])) return blocks[index];
  }
  return null;
}

function stateForClaudeSessionEvent(event: ClaudeSessionEvent): CodexActivityState | null {
  if (event.type === "assistant") {
    const blocks = claudeContentBlocks(event);
    if (blocks.some((block) => block.type === "tool_use")) return "working";
    if (textFromClaudeContent(event.message?.content)) return "complete";
  }
  if (event.type === "user") {
    const blocks = claudeContentBlocks(event);
    if (blocks.some((block) => block.type === "tool_result" && block.is_error === true)) return "error";
    if (blocks.some((block) => block.type === "tool_result")) return "reviewing";
    if (textFromClaudeContent(event.message?.content)) return "working";
  }
  return null;
}

function messageForClaudeSessionEvent(
  event: ClaudeSessionEvent,
  labels: SettingsCopy,
  events: ClaudeSessionEvent[],
  eventIndex: number
): string | null {
  if (event.type === "assistant") {
    const toolUse = latestClaudeContentBlock(claudeContentBlocks(event), (block) => block.type === "tool_use");
    if (toolUse) return messageForCodexToolActivity(classifyClaudeToolUse(toolUse), labels, true);
    if (textFromClaudeContent(event.message?.content)) return labels.codexWaitingForNextPrompt;
  }

  if (event.type === "user") {
    const toolResult = latestClaudeContentBlock(claudeContentBlocks(event), (block) => block.type === "tool_result");
    if (toolResult) {
      const toolUse = latestClaudeToolUse(events, eventIndex, toolResult.tool_use_id);
      const activity = toolUse ? classifyClaudeToolUse(toolUse) : { type: "toolCall", toolName: null } satisfies CodexToolActivity;
      return messageForCodexToolActivity(activity, labels, false);
    }
    if (textFromClaudeContent(event.message?.content)) return labels.codexReadingPrompt;
  }

  return null;
}

function titleForClaudeSession(events: ClaudeSessionEvent[], filePath: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const title = compactCodexText(firstString([event.title, event.summary, event.name, event.lastPrompt]), 42);
    if (title) return title;
  }
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type !== "user") continue;
    const title = textFromClaudeContent(events[index].message?.content);
    if (title) return title;
  }
  return basename(filePath, extname(filePath));
}

async function readClaudeCodeSessionTitles(sessionIds: Set<string>): Promise<Map<string, string>> {
  if (!sessionIds.size) return new Map();
  const files = (await findJsonFiles(claudeCodeSessionsRoot()))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 400);
  const titles = new Map<string, { title: string; lastActivityAt: number }>();

  for (const file of files) {
    let metadata: ClaudeCodeSessionMetadata;
    try {
      metadata = JSON.parse(await readFile(file.path, "utf8")) as ClaudeCodeSessionMetadata;
    } catch {
      continue;
    }

    const sessionId = metadata.cliSessionId;
    const title = compactCodexText(metadata.title ?? "General coding session", 42);
    if (!sessionId || !sessionIds.has(sessionId) || !title) continue;
    const lastActivityAt = typeof metadata.lastActivityAt === "number" ? metadata.lastActivityAt : file.mtimeMs;
    const existing = titles.get(sessionId);
    if (!existing || lastActivityAt >= existing.lastActivityAt) {
      titles.set(sessionId, { title, lastActivityAt });
    }
  }

  return new Map(Array.from(titles, ([sessionId, value]) => [sessionId, value.title]));
}

async function inferClaudeSessionFileActivity(file: {
  path: string;
  mtimeMs: number;
}): Promise<CodexActivitySession | null> {
  const labels = text().settings;
  const [head, tail] = await Promise.all([
    readFileHead(file.path, 64 * 1024),
    readFileTail(file.path, CODEX_SESSION_TAIL_BYTES)
  ]);
  const events = parseClaudeSessionEvents(`${head}\n${tail}`);

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const state = stateForClaudeSessionEvent(event);
    if (!state) continue;

    const updatedAt = event.timestamp ? Date.parse(event.timestamp) : file.mtimeMs;
    if (!Number.isFinite(updatedAt)) return null;
    if (Date.now() - updatedAt > codexActivityFreshMs(state)) return null;

    const id = event.sessionId ?? basename(file.path, extname(file.path));
    return {
      id,
      title: titleForClaudeSession(events, file.path),
      state,
      message: messageForClaudeSessionEvent(event, labels, events, index),
      updatedAt,
      path: file.path
    };
  }

  return null;
}

async function inferClaudeSessionActivity(): Promise<CodexActivity | null> {
  const files = (await findCodexSessionFiles(claudeProjectsRoot()))
    .filter((file) => Date.now() - file.mtimeMs <= CODEX_SESSION_ACTIVE_STALE_MS)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 50);
  if (!files.length) return null;

  const sessions = (await Promise.all(files.map(inferClaudeSessionFileActivity)))
    .filter((session): session is CodexActivitySession => Boolean(session));
  if (!sessions.length) return null;
  const titles = await readClaudeCodeSessionTitles(new Set(sessions.map((session) => session.id)));
  const titledSessions = sessions.map((session) => ({
    ...session,
    title: titles.get(session.id) ?? session.title
  }));
  return aggregateSessionActivity(titledSessions, text().settings, "claude", "claude-session");
}

async function pollCodexActivity(): Promise<void> {
  const provider = agentActivityProviderForPet();
  if (!provider) {
    setCodexActivity(emptyAgentActivity("codex"));
    return;
  }

  let stored: CodexActivity | null = null;
  let inferred: CodexActivity | null = null;
  if (provider === "codex") {
    [stored, inferred] = await Promise.all([
      readStoredCodexActivity(),
      inferCodexSessionActivity()
    ]);
  } else {
    inferred = await inferClaudeSessionActivity();
  }

  if (
    stored?.source === "codex-session" &&
    stored.updatedAt &&
    Date.now() - stored.updatedAt > codexActivityFreshMs(stored.state)
  ) {
    stored = null;
  }

  const next =
    inferred &&
    (stored?.source === "codex-session" || !stored?.updatedAt || inferred.updatedAt! >= stored.updatedAt)
      ? inferred
      : stored;

  if (next) {
    if (next.source === "codex-session") {
      await writeCodexActivityFile(next);
    }
    setCodexActivity(next);
    return;
  }

  setCodexActivity(emptyAgentActivity(provider));
}

function scheduleCodexActivityPolling(): void {
  if (codexActivityTimer) clearInterval(codexActivityTimer);
  void pollCodexActivity();
  codexActivityTimer = setInterval(() => void pollCodexActivity(), CODEX_SESSION_POLL_MS);
}

function setPetFacing(next: PetFacing): void {
  if (petFacing === next) return;
  petFacing = next;
  publishSnapshot();
}

function showBubble(bubble: SpeechBubble): void {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  sendToPet("pet:show-bubble", bubble);
  if (bubble.autoDismissMs) {
    bubbleTimer = setTimeout(() => hideBubble(), bubble.autoDismissMs);
  }
}

function hideBubble(): void {
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
  sendToPet("pet:hide-bubble");
}

function rendererUrl(route: "pet" | "settings"): string {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) return `${devServer}#${route}`;
  return RENDERER_HTML_PATH;
}

function loadRenderer(win: BrowserWindow, route: "pet" | "settings"): void {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) {
    void win.loadURL(rendererUrl(route));
    return;
  }
  void win.loadFile(rendererUrl(route), { hash: route });
}

function toDisplayBounds(display: Electron.Display): DisplayBounds {
  return {
    id: display.id,
    workArea: display.workArea
  };
}

function currentDisplays(): DisplayBounds[] {
  return screen.getAllDisplays().map(toDisplayBounds);
}

function primaryDisplay(): DisplayBounds {
  return toDisplayBounds(screen.getPrimaryDisplay());
}

function initialPetBounds(): Electron.Rectangle {
  const stored = store.get("petPosition");
  return initialWindowBounds({
    displays: currentDisplays(),
    primaryDisplay: primaryDisplay(),
    size: petWindowSize(),
    saved: stored
  });
}

function persistPetPosition(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  store.set("petPosition", savedPositionFromBounds(currentDisplays(), bounds, primaryDisplay()));
}

function keepPetWindowInVisibleWorkArea(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  const nextBounds = visibleWindowBounds(currentDisplays(), primaryDisplay(), bounds);
  if (bounds.x !== nextBounds.x || bounds.y !== nextBounds.y) {
    petWindow.setBounds(nextBounds);
  }
  persistPetPosition();
  publishSnapshot();
}

function schedulePetDisplayRepair(): void {
  if (displayChangeTimer) clearTimeout(displayChangeTimer);
  displayChangeTimer = setTimeout(() => {
    displayChangeTimer = null;
    keepPetWindowInVisibleWorkArea();
  }, 250);
}

function registerDisplayChangeHandlers(): void {
  screen.on("display-added", schedulePetDisplayRepair);
  screen.on("display-removed", schedulePetDisplayRepair);
  screen.on("display-metrics-changed", schedulePetDisplayRepair);
}

function registerPowerMonitorHandlers(): void {
  powerMonitor.on("lock-screen", pauseReminderTimersForAway);
  powerMonitor.on("suspend", pauseReminderTimersForAway);
  powerMonitor.on("unlock-screen", restartReminderTimersAfterAway);
  powerMonitor.on("resume", restartReminderTimersAfterAway);
}

function createPetWindow(): void {
  const bounds = initialPetBounds();
  petMouseInteractive = true;
  petWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV
    }
  });

  petWindow.setAlwaysOnTop(true, process.platform === "darwin" ? "floating" : "normal");
  if (process.platform === "darwin") {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  setPetMouseInteractive(false);
  loadRenderer(petWindow, "pet");
  petWindow.once("ready-to-show", () => {
    petWindow?.showInactive();
    updateTrayMenu();
    publishSnapshot();
  });
  petWindow.on("show", () => {
    updateTrayMenu();
    publishSnapshot();
  });
  petWindow.on("hide", () => {
    stopPetDrag();
    stopPetResize();
    updateTrayMenu();
    publishSnapshot();
  });
  petWindow.on("closed", () => {
    stopPetDrag();
    stopPetResize();
    petWindow = null;
    updateTrayMenu();
    publishSnapshot();
  });
}

function ensurePetWindowVisible(): void {
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  if (petWindow && !petWindow.isVisible()) petWindow.showInactive();
  updateTrayMenu();
  publishSnapshot();
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: SETTINGS_WINDOW.width,
    height: SETTINGS_WINDOW.height,
    title: `${APP_NAME} ${text().menu.settings}`,
    resizable: true,
    minWidth: SETTINGS_WINDOW.width,
    maxWidth: SETTINGS_WINDOW.width,
    minHeight: 400,
    show: false,
    backgroundColor: "#faf6ee",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV
    }
  });

  loadRenderer(settingsWindow, "settings");
  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
    publishSnapshot();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createTray(): void {
  tray = new Tray(createTrayImage());
  tray.setToolTip(APP_NAME);
  tray.on("click", () => {
    tray?.popUpContextMenu();
  });
  if (process.platform !== "darwin") {
    nativeTheme.on("updated", () => tray?.setImage(createTrayImage()));
  }
  updateTrayMenu();
}

function togglePetWindowVisibility(): void {
  if (!petWindow) createPetWindow();
  if (!petWindow) return;
  if (petWindow.isVisible()) petWindow.hide();
  else petWindow.showInactive();
  updateTrayMenu();
  sendToAll("app:snapshot", snapshot());
}

function hidePetWindowFromMenu(): void {
  petWindow?.hide();
  updateTrayMenu();
  sendToAll("app:snapshot", snapshot());
}

function finishQuitAfterAnimation(): void {
  if (quitAnimationTimer) {
    clearInterval(quitAnimationTimer);
    quitAnimationTimer = null;
  }
  quitAfterAnimation = true;
  app.quit();
}

function runQuitAnimation(): void {
  if (quitAnimationRunning) return;
  quitAnimationRunning = true;
  clearRuntimeTimers();
  blockingMode = null;
  focusActive = false;
  settingsWindow?.close();

  if (!petWindow || petWindow.isDestroyed()) {
    finishQuitAfterAnimation();
    return;
  }

  const win = petWindow;
  if (!win.isVisible()) win.showInactive();
  setPetMouseInteractive(false);
  petState = "quitRunning";
  const startBounds = win.getBounds();
  const target = horizontalRunTarget(currentDisplays(), primaryDisplay(), startBounds);
  petFacing = target.facing;
  publishSnapshot();

  const endX = target.endX;
  const startX = startBounds.x;
  const startAt = Date.now();
  const durationMs = Math.max(2800, Math.min(6400, Math.abs(endX - startX) * 16));

  quitAnimationTimer = setInterval(() => {
    if (win.isDestroyed()) {
      finishQuitAfterAnimation();
      return;
    }

    const progress = Math.min(1, (Date.now() - startAt) / durationMs);
    const eased = 1 - (1 - progress) ** 3;
    win.setBounds({
      ...startBounds,
      x: Math.round(startX + (endX - startX) * eased)
    });

    if (progress >= 1) finishQuitAfterAnimation();
  }, 16);
}

function menuState() {
  return {
    appName: APP_NAME,
    dogVisible: Boolean(petWindow?.isVisible()),
    focusActive,
    isPackaged: app.isPackaged
  };
}

function menuActions() {
  return {
    toggleDog: togglePetWindowVisibility,
    hideDog: hidePetWindowFromMenu,
    startFocus: startFocusMode,
    stopFocusFromMenu: () => stopFocusMode(true),
    stopFocusFromContext: () => stopFocusMode(false),
    openSettings: createSettingsWindow,
    quit: runQuitAnimation,
    triggerDemo
  };
}

function updateApplicationMenu(): void {
  const labels = text().menu;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildApplicationMenuTemplate(labels, menuState(), menuActions()))
  );
}

function updateTrayMenu(): void {
  updateApplicationMenu();
  if (!tray) return;
  const labels = text().menu;
  tray.setContextMenu(
    Menu.buildFromTemplate(buildTrayMenuTemplate(labels, menuState(), menuActions()))
  );
}

function showPetContextMenu(): void {
  const labels = text().menu;
  Menu.buildFromTemplate(buildPetContextMenuTemplate(labels, menuState(), menuActions())).popup({
    window: petWindow ?? undefined
  });
}

function movePetWithCursor(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const currentBounds = petWindow.getBounds();
  const bounds = visibleWindowBounds(
    currentDisplays(),
    primaryDisplay(),
    {
      width: currentBounds.width,
      height: currentBounds.height,
      x: cursor.x - dragOffset.x,
      y: cursor.y - dragOffset.y
    },
    petDragOverflow()
  );
  petWindow.setBounds(bounds);
}

function startPetDrag(offset: { offsetX: number; offsetY: number }): void {
  if (blockingMode === "breakRun" || !petWindow || petWindow.isDestroyed()) return;
  stopPetResize();
  const bounds = petWindow.getBounds();
  dragOffset = {
    x: Math.min(Math.max(Math.round(offset.offsetX), 0), bounds.width),
    y: Math.min(Math.max(Math.round(offset.offsetY), 0), bounds.height)
  };
  if (dragTimer) clearInterval(dragTimer);
  if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
  movePetWithCursor();
  dragTimer = setInterval(movePetWithCursor, 16);
  dragSafetyTimer = setTimeout(stopPetDrag, 15_000);
}

function stopPetDrag(): void {
  const wasDragging = Boolean(dragTimer || dragSafetyTimer);
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  if (dragSafetyTimer) {
    clearTimeout(dragSafetyTimer);
    dragSafetyTimer = null;
  }
  if (wasDragging) {
    persistPetPosition();
    sendToAll("app:snapshot", snapshot());
  }
}

function movePetResizeWithCursor(): void {
  if (!petResizeSession || !petWindow || petWindow.isDestroyed()) return;

  const cursor = screen.getCursorScreenPoint();
  const dx = cursor.x - petResizeSession.startCursor.x;
  const dy = cursor.y - petResizeSession.startCursor.y;
  const nextScale = normalizePetScale(
    petResizeSession.startScale + (dx / PET_WINDOW.width + dy / PET_WINDOW.height) / 2
  );
  const nextSize = petWindowSize(nextScale);
  const nextBounds = visibleWindowBounds(currentDisplays(), primaryDisplay(), {
    x: petResizeSession.startBounds.x,
    y: petResizeSession.startBounds.y,
    width: nextSize.width,
    height: nextSize.height
  });

  petScale = nextScale;
  petWindow.setBounds(nextBounds);
  publishSnapshot();
}

function startPetResize(): void {
  if (blockingMode === "breakRun" || !petWindow || petWindow.isDestroyed()) return;
  stopPetDrag();
  petResizeSession = {
    startCursor: screen.getCursorScreenPoint(),
    startBounds: petWindow.getBounds(),
    startScale: petScale
  };
  if (resizeTimer) clearInterval(resizeTimer);
  if (resizeSafetyTimer) clearTimeout(resizeSafetyTimer);
  movePetResizeWithCursor();
  resizeTimer = setInterval(movePetResizeWithCursor, 16);
  resizeSafetyTimer = setTimeout(stopPetResize, 15_000);
}

function stopPetResize(): void {
  const wasResizing = Boolean(petResizeSession || resizeTimer || resizeSafetyTimer);
  petResizeSession = null;
  if (resizeTimer) {
    clearInterval(resizeTimer);
    resizeTimer = null;
  }
  if (resizeSafetyTimer) {
    clearTimeout(resizeSafetyTimer);
    resizeSafetyTimer = null;
  }
  if (wasResizing) {
    store.set("petScale", petScale);
    persistPetPosition();
    publishSnapshot();
  }
}

function clearBreakRunTimers(): void {
  if (breakRunTimer) {
    clearTimeout(breakRunTimer);
    breakRunTimer = null;
  }
  if (breakRunCountdownTimer) {
    clearInterval(breakRunCountdownTimer);
    breakRunCountdownTimer = null;
  }
  if (breakRunMovementTimer) {
    clearInterval(breakRunMovementTimer);
    breakRunMovementTimer = null;
  }
}

function showBreakRunCountdown(endsAt: number): void {
  const labels = text();
  const remainingSeconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const formatter = breakRunFormatter ?? pick(labels.bubble.breakRun);
  showBubble({
    id: "break-run",
    message: formatter(remainingSeconds),
    actions: [{ id: "break-run:done", label: labels.actions.breakRunDone, kind: "primary" }]
  });
}

function chooseBreakRunVelocity(): PetPosition {
  const speed = 3.5 + Math.random() * 2.9;
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed
  };
}

function movePetForBreakRun(): void {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;

  const bounds = petWindow.getBounds();
  const workArea = screen.getDisplayNearestPoint({
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2)
  }).workArea;
  const now = Date.now();
  const minX = workArea.x + 8;
  const maxX = workArea.x + workArea.width - bounds.width - 8;
  const minY = workArea.y + 8;
  const maxY = workArea.y + workArea.height - bounds.height - 8;

  if (now >= nextBreakRunTurnAt && Math.random() < 0.45) {
    breakRunVelocity = chooseBreakRunVelocity();
  }

  let nextX = bounds.x + breakRunVelocity.x;
  let nextY = bounds.y + breakRunVelocity.y;

  if (nextX <= minX) {
    nextX = minX;
    breakRunVelocity.x = Math.abs(breakRunVelocity.x);
  }
  if (nextX >= maxX) {
    nextX = maxX;
    breakRunVelocity.x = -Math.abs(breakRunVelocity.x);
  }
  if (nextY <= minY) {
    nextY = minY;
    breakRunVelocity.y = Math.abs(breakRunVelocity.y);
  }
  if (nextY >= maxY) {
    nextY = maxY;
    breakRunVelocity.y = -Math.abs(breakRunVelocity.y);
  }

  if (now >= nextBreakRunTurnAt) {
    nextBreakRunTurnAt = now + 350 + Math.round(Math.random() * 850);
  }

  setPetFacing(breakRunVelocity.x >= 0 ? "right" : "left");
  petWindow.setBounds({
    ...bounds,
    x: Math.round(nextX),
    y: Math.round(nextY)
  });
}

function finishBreakRun(): void {
  clearBreakRunTimers();
  breakRunFormatter = null;
  blockingMode = null;
  hideBubble();
  showBubble({ id: "break-run-complete", message: pick(text().bubble.breakRunComplete), autoDismissMs: 2200 });
  setPetState("breakDone");
  setTimeout(() => {
    if (!blockingMode && !focusActive) {
      hideBubble();
      setPetState("idle");
      scheduleReminderTimers();
    }
  }, 2300);
  publishSnapshot();
}

function startBreakRun(): void {
  ensurePetWindowVisible();
  clearBreakRunTimers();
  blockingMode = "breakRun";
  breakDueAt = null;
  breakRunFormatter = pick(text().bubble.breakRun);
  breakRunVelocity = chooseBreakRunVelocity();
  nextBreakRunTurnAt = Date.now();
  setPetState("breakRunning");
  setPetFacing(breakRunVelocity.x >= 0 ? "right" : "left");
  const durationMs = getSettings().breakRunDurationSeconds * 1000;
  const endsAt = Date.now() + durationMs;
  showBreakRunCountdown(endsAt);
  breakRunCountdownTimer = setInterval(() => showBreakRunCountdown(endsAt), 1000);
  breakRunMovementTimer = setInterval(movePetForBreakRun, BREAK_RUN_TICK_MS);
  breakRunTimer = setTimeout(finishBreakRun, durationMs);
  publishSnapshot();
}

function clearReminderTimers(): void {
  if (breakTimer) clearTimeout(breakTimer);
  if (hydrationTimer) clearTimeout(hydrationTimer);
  breakTimer = null;
  hydrationTimer = null;
  breakDueAt = null;
  hydrationDueAt = null;
}

function scheduleReminderTimers(): void {
  clearReminderTimers();

  const settings = getSettings();
  if (settings.breakReminderEnabled && !breakMutedToday) {
    breakDueAt = Date.now() + settings.breakIntervalMinutes * 60 * 1000;
    breakTimer = setTimeout(
      () => triggerBreakReminder(false),
      settings.breakIntervalMinutes * 60 * 1000
    );
  }
  if (settings.hydrationReminderEnabled) {
    hydrationDueAt = Date.now() + settings.hydrationIntervalMinutes * 60 * 1000;
    hydrationTimer = setTimeout(
      () => triggerHydrationReminder(false),
      settings.hydrationIntervalMinutes * 60 * 1000
    );
  }
  publishSnapshot();
}

function pauseReminderTimersForAway(): void {
  const wasReminderActive = blockingMode === "break" || blockingMode === "hydration";
  clearReminderTimers();
  if (wasReminderActive) {
    blockingMode = null;
    hideBubble();
    setPetState(focusActive ? "focusGuard" : "idle");
  }
  publishSnapshot();
}

function restartReminderTimersAfterAway(): void {
  if (blockingMode === "breakRun") return;
  if (blockingMode === "break" || blockingMode === "hydration") {
    blockingMode = null;
    hideBubble();
    setPetState(focusActive ? "focusGuard" : "idle");
  }
  scheduleReminderTimers();
}

function setDistractionStatus(partial: Partial<DistractionStatus>): void {
  distractionStatus = { ...distractionStatus, ...partial };
  publishSnapshot();
}

async function checkDistractionNow(): Promise<void> {
  const settings = getSettings();
  if (!settings.distractionDetectionEnabled) return;

  try {
    const active = await readActiveWindow();
    const matchedRule = classifyDistraction(active, settings);
    const now = Date.now();

    setDistractionStatus({
      state: "watching",
      activeApp: active.appName,
      activeWindowTitle: active.windowTitle,
      matchedRule,
      lastCheckedAt: now,
      error: null
    });

    if (!focusActive || blockingMode === "focusWarning") return;
    if (!matchedRule) return;
    if (
      distractionStatus.lastWarningAt &&
      now - distractionStatus.lastWarningAt < DISTRACTION_WARNING_COOLDOWN_MS
    ) {
      return;
    }

    setDistractionStatus({ lastWarningAt: now });
    triggerFocusWarning(matchedRule.replace(/^(app|keyword):/, ""));
  } catch (error) {
    setDistractionStatus({
      state: isPermissionError(error) ? "permission-needed" : "error",
      error: error instanceof Error ? error.message : String(error),
      lastCheckedAt: Date.now()
    });
  }
}

function scheduleDistractionDetection(): void {
  if (distractionTimer) {
    clearInterval(distractionTimer);
    distractionTimer = null;
  }
  if (distractionStartupTimer) {
    clearTimeout(distractionStartupTimer);
    distractionStartupTimer = null;
  }

  const settings = getSettings();
  if (!settings.distractionDetectionEnabled) {
    setDistractionStatus({
      state: "idle",
      matchedRule: null,
      error: null
    });
    return;
  }

  setDistractionStatus({
    state: process.platform === "darwin" ? "watching" : "unsupported",
    error: process.platform === "darwin" ? null : text().system.unsupportedDistraction
  });

  if (process.platform !== "darwin") return;

  const firstCheckDelay = focusActive ? Math.max(0, settings.distractionGraceSeconds * 1000) : 0;
  distractionStartupTimer = setTimeout(() => {
    void checkDistractionNow();
    distractionTimer = setInterval(() => void checkDistractionNow(), DISTRACTION_CHECK_INTERVAL_MS);
  }, firstCheckDelay);
}

function resumeLongTermState(): void {
  blockingMode = null;
  hideBubble();
  if (focusActive) {
    setPetState("focusGuard");
    sendToAll("app:snapshot", snapshot());
    return;
  }
  setPetState("idle");
  sendToAll("app:snapshot", snapshot());
}

function happyFeedback(message: string | null = pick(text().bubble.woof), after?: () => void): void {
  if (blockingMode) return;
  const returnState = focusActive ? "focusGuard" : "idle";
  setPetState("happy");
  if (message) {
    showBubble({ id: "happy", message, autoDismissMs: 1800 });
  }
  setTimeout(() => {
    hideBubble();
    setPetState(returnState);
    after?.();
  }, 1900);
}

function setUpdateCheck(next: UpdateCheckResult): void {
  updateCheck = next;
  publishSnapshot();
}

function openReleaseNotes(): void {
  void shell.openExternal(updateCheck.releaseUrl || RELEASES_URL).catch((error) => {
    console.error("Failed to open PawPal releases:", error);
  });
}

function openCodexSession(sessionId: string): void {
  const threadId = sessionId.trim();
  if (!CODEX_THREAD_ID_PATTERN.test(threadId)) return;
  void shell.openExternal(`codex://threads/${threadId}`).catch((error) => {
    console.error("Failed to open Codex session:", error);
  });
}

async function openClaudeSession(sessionId: string): Promise<void> {
  const cliSessionId = sessionId.trim();
  if (!CODEX_THREAD_ID_PATTERN.test(cliSessionId)) return;
  await shell.openExternal(`claude://resume?session=${encodeURIComponent(cliSessionId)}&pawpal=${Date.now()}`);
}

async function openAgentSession(sessionId: string): Promise<void> {
  try {
    if (codexActivity.provider === "claude") {
      await openClaudeSession(sessionId);
      return;
    }
    if (codexActivity.provider === "codex") {
      openCodexSession(sessionId);
    }
  } catch (error) {
    console.error("Failed to open agent session:", error);
    return;
  }
}

function showUpdateAvailableNotice(result: UpdateCheckResult): void {
  if (blockingMode || result.status !== "available" || !result.latestVersion) return;
  ensurePetWindowVisible();
  setPetState("happy");
  showBubble({
    id: "update-available",
    message: pick(text().bubble.updateAvailable)(result.latestVersion),
    actions: [
      { id: "app:open-release-notes", label: text().settings.openReleaseNotes, kind: "primary" }
    ],
    autoDismissMs: 12000
  });
  setTimeout(() => {
    if (!blockingMode && petState === "happy") setPetState(focusActive ? "focusGuard" : "idle");
  }, 12_100);
}

async function checkForUpdates(options: { notifyAvailable?: boolean } = {}): Promise<UpdateCheckResult> {
  const checking = createCheckingUpdateCheck(updateCheck);
  setUpdateCheck(checking);
  const result = await checkGitHubReleasesForUpdates(checking);
  setUpdateCheck(result);
  if (options.notifyAvailable) showUpdateAvailableNotice(result);
  return result;
}

function triggerBreakReminder(fromDemo: boolean): void {
  if (blockingMode === "focusWarning" || blockingMode === "breakRun") return;
  if (!fromDemo && (focusActive || breakMutedToday)) {
    scheduleReminderTimers();
    return;
  }
  ensurePetWindowVisible();
  blockingMode = "break";
  breakDueAt = null;
  publishSnapshot();
  setPetState("breakPrompt");
  const labels = text();
  showBubble({
    id: "break",
    message: pick(labels.bubble.breakReminder),
    actions: [
      { id: "break:done", label: labels.actions.breakDone, kind: "primary" },
      { id: "break:snooze", label: labels.actions.breakSnooze },
      { id: "break:mute", label: labels.actions.breakMute, kind: "danger" }
    ]
  });
}

function triggerHydrationReminder(fromDemo: boolean): void {
  if (blockingMode || (!fromDemo && focusActive)) {
    scheduleReminderTimers();
    return;
  }
  ensurePetWindowVisible();
  blockingMode = "hydration";
  hydrationDueAt = null;
  publishSnapshot();
  setPetState("hydrationPrompt");
  const labels = text();
  showBubble({
    id: "hydration",
    message: pick(labels.bubble.hydrationReminder),
    actions: [
      { id: "hydration:done", label: labels.actions.hydrationDone, kind: "primary" },
      { id: "hydration:snooze", label: labels.actions.hydrationSnooze }
    ]
  });
}

function triggerFocusWarning(rule?: string): void {
  if (blockingMode === "breakRun") return;
  ensurePetWindowVisible();
  if (!focusActive) startFocusMode();
  blockingMode = "focusWarning";
  updateStats((stats) => ({ ...stats, focusWarnings: stats.focusWarnings + 1 }));
  setPetState("focusAlert");
  sendToAll("app:snapshot", snapshot());
  const labels = text();
  showBubble({
    id: "focus-warning",
    message: pick(labels.bubble.focusWarning)(rule ?? "?"),
    actions: [
      { id: "focus:back", label: labels.actions.focusBack, kind: "primary" },
      { id: "focus:end", label: labels.actions.focusEnd }
    ]
  });
}

function startFocusMode(): void {
  if (focusActive || blockingMode) return;
  ensurePetWindowVisible();
  const settings = getSettings();
  focusActive = true;
  focusStartedAt = Date.now();
  blockingMode = null;
  setPetState("focusGuard");
  focusEndsAt = Date.now() + settings.focusDurationMinutes * 60 * 1000;
  sendToAll("app:snapshot", snapshot());
  showBubble({
    id: "focus-start",
    message: pick(text().bubble.focusStart)(settings.focusDurationMinutes),
    autoDismissMs: 4500
  });
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = setTimeout(
    () => stopFocusMode(true),
    settings.focusDurationMinutes * 60 * 1000
  );
  scheduleDistractionDetection();
  updateTrayMenu();
}

function stopFocusMode(completed: boolean): void {
  if (!focusActive) return;
  const startedAt = focusStartedAt ?? Date.now();
  const elapsedMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  focusActive = false;
  focusStartedAt = null;
  blockingMode = null;
  if (focusTimer) {
    clearTimeout(focusTimer);
    focusTimer = null;
  }
  focusEndsAt = null;
  scheduleDistractionDetection();
  updateStats((stats) => ({
    ...stats,
    focusMinutes: stats.focusMinutes + elapsedMinutes
  }));
  sendToAll("app:snapshot", snapshot());
  setPetState("focusDone");
  showBubble({
    id: "focus-complete",
    message: completed ? pick(text().bubble.focusComplete) : pick(text().bubble.focusCancelled),
    autoDismissMs: 2800
  });
  setTimeout(() => {
    if (!focusActive && !blockingMode) {
      hideBubble();
      setPetState("idle");
    }
  }, 2900);
  updateTrayMenu();
}

function triggerDemo(trigger: DemoTrigger): void {
  ensurePetWindowVisible();
  if (trigger === "break") triggerBreakReminder(true);
  if (trigger === "hydration") triggerHydrationReminder(true);
  if (trigger === "focusWarning") triggerFocusWarning("Twitter");
  if (trigger === "happy") happyFeedback(pick(text().bubble.woof));
  if (trigger === "codexIdle") {
    void writeCodexActivityDemo("idle", null);
  }
  if (trigger === "codexWorking") {
    void writeCodexActivityDemo("working", "Editing files");
  }
  if (trigger === "codexReviewing") {
    void writeCodexActivityDemo("reviewing", "Checking changes");
  }
  if (trigger === "codexWaiting") {
    void writeCodexActivityDemo("waiting", "Waiting for input");
  }
  if (trigger === "codexError") {
    void writeCodexActivityDemo("error", "Something failed");
  }
}

function handleBubbleAction(actionId: string): void {
  if (actionId === "app:open-release-notes") {
    hideBubble();
    setPetState(focusActive ? "focusGuard" : "idle");
    openReleaseNotes();
    return;
  }
  if (actionId === "break-run:done") {
    finishBreakRun();
    return;
  }
  if (actionId === "break:done") {
    updateStats((stats) => ({ ...stats, breaksTaken: stats.breaksTaken + 1 }));
    startBreakRun();
    return;
  }
  if (actionId === "break:snooze") {
    resumeLongTermState();
    if (breakTimer) clearTimeout(breakTimer);
    breakDueAt = Date.now() + 10 * 60 * 1000;
    breakTimer = setTimeout(() => triggerBreakReminder(false), 10 * 60 * 1000);
    publishSnapshot();
    return;
  }
  if (actionId === "break:mute") {
    breakMutedToday = true;
    breakDueAt = null;
    blockingMode = null;
    sendToAll("app:snapshot", snapshot());
    setPetState("sad");
    showBubble({ id: "break-muted", message: pick(text().bubble.breakIgnore), autoDismissMs: 2600 });
    setTimeout(resumeLongTermState, 2700);
    return;
  }
  if (actionId === "hydration:done") {
    updateStats((stats) => ({ ...stats, watersLogged: stats.watersLogged + 1 }));
    blockingMode = null;
    sendToAll("app:snapshot", snapshot());
    setPetState("drinking");
    hideBubble();
    setTimeout(() => {
      if (blockingMode) return;
      setPetState("hydrationDone");
      showBubble({ id: "hydration-complete", message: pick(text().bubble.hydrationDone), autoDismissMs: 1800 });
      setTimeout(() => {
        hideBubble();
        setPetState(focusActive ? "focusGuard" : "idle");
        scheduleReminderTimers();
      }, 1900);
    }, 2400);
    return;
  }
  if (actionId === "hydration:snooze") {
    resumeLongTermState();
    if (hydrationTimer) clearTimeout(hydrationTimer);
    hydrationDueAt = Date.now() + 15 * 60 * 1000;
    hydrationTimer = setTimeout(() => triggerHydrationReminder(false), 15 * 60 * 1000);
    publishSnapshot();
    return;
  }
  if (actionId === "focus:back") {
    blockingMode = null;
    sendToAll("app:snapshot", snapshot());
    setPetState("focusGuard");
    showBubble({ id: "focus-back", message: pick(text().bubble.focusBack), autoDismissMs: 1800 });
    setTimeout(() => {
      if (focusActive && !blockingMode) hideBubble();
    }, 1900);
    return;
  }
  if (actionId === "focus:end") {
    stopFocusMode(false);
  }
}

function registerIpc(): void {
  ipcMain.handle("app:get-snapshot", () => snapshot());
  ipcMain.handle("app:check-for-updates", () => checkForUpdates({ notifyAvailable: true }));
  ipcMain.handle("custom-pet:select-asset", (_event, state: PetState) =>
    selectCustomPetAsset(state)
  );
  ipcMain.handle("custom-pet:import-asset", (_event, state: PetState, sourcePath: string) =>
    importCustomPetAsset(state, sourcePath)
  );
  ipcMain.on("app:open-release-notes", openReleaseNotes);
  ipcMain.on("pet:clicked", () => {
    if (blockingMode) return;
    happyFeedback(null);
  });
  ipcMain.on("pet:context-menu", showPetContextMenu);
  ipcMain.on("pet:drag-start", (_event, offset: { offsetX: number; offsetY: number }) =>
    startPetDrag(offset)
  );
  ipcMain.on("pet:drag-stop", stopPetDrag);
  ipcMain.on("pet:resize-start", startPetResize);
  ipcMain.on("pet:resize-stop", stopPetResize);
  ipcMain.on("agent:open-session", (_event, sessionId: string) => openAgentSession(sessionId));
  ipcMain.on("codex:open-session", (_event, sessionId: string) => openAgentSession(sessionId));
  ipcMain.on("pet:set-mouse-interactive", (_event, interactive: boolean) => {
    setPetMouseInteractive(interactive);
  });
  ipcMain.on("bubble:action", (_event, actionId: string) => handleBubbleAction(actionId));
  ipcMain.on("settings:update", (_event, partial: Partial<Settings>) => {
    setSettings({ ...getSettings(), ...partial });
  });
  ipcMain.on("demo:trigger", (_event, trigger: DemoTrigger) => triggerDemo(trigger));
  ipcMain.on("focus:start", startFocusMode);
  ipcMain.on("focus:stop", () => stopFocusMode(false));
  ipcMain.on("stats:reset-today", resetTodayStats);
}

protocol.registerSchemesAsPrivileged([
  { scheme: "pawpal-asset", privileges: { bypassCSP: true, supportFetchAPI: true } }
]);

app.whenReady().then(() => {
  protocol.handle("pawpal-asset", (request) => {
    let relativePath = "";
    try {
      const url = new URL(request.url);
      relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch {
      return new Response("Invalid asset URL", { status: 404 });
    }

    const appBase = app.isPackaged ? process.resourcesPath : process.cwd();
    const builtInAssetRoot = resolve(appBase, "pet_assets");
    const customAssetRoot = resolve(app.getPath("userData"), "custom_pet_assets");
    const assetPath = relativePath.startsWith("custom_pet_assets/")
      ? resolve(app.getPath("userData"), relativePath)
      : resolve(appBase, relativePath);
    const isInsideBuiltInAssetRoot =
      assetPath === builtInAssetRoot || assetPath.startsWith(`${builtInAssetRoot}${sep}`);
    const isInsideCustomAssetRoot =
      assetPath === customAssetRoot || assetPath.startsWith(`${customAssetRoot}${sep}`);

    if (!isInsideBuiltInAssetRoot && !isInsideCustomAssetRoot) {
      return new Response("Asset not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(assetPath).href);
  });

  getStats();
  registerIpc();
  createPetWindow();
  createTray();
  registerDisplayChangeHandlers();
  registerPowerMonitorHandlers();
  scheduleCodexActivityPolling();
  scheduleReminderTimers();
  scheduleDistractionDetection();
  if (IS_DEV) {
    createSettingsWindow();
  }
  if (getSettings().checkUpdatesOnLaunchEnabled) {
    setTimeout(() => void checkForUpdates({ notifyAvailable: true }), 1500);
  }

  app.on("activate", () => {
    if (!petWindow) createPetWindow();
  });
});

app.on("before-quit", (event) => {
  if (!quitAfterAnimation) {
    event.preventDefault();
    runQuitAnimation();
    return;
  }
  clearRuntimeTimers();
  if (quitAnimationTimer) {
    clearInterval(quitAnimationTimer);
    quitAnimationTimer = null;
  }
});

app.on("window-all-closed", () => {
  // Keep the menu-bar utility alive after the settings window is closed.
});
