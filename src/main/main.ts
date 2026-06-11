import { execFile } from "node:child_process";
import { basename, extname, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
  DEFAULT_SETTINGS,
  todayKey
} from "../shared/constants";
import { i18n, pick } from "../shared/i18n";
import { PET_STATE_ORDER } from "../shared/petAppearances";
import type {
  AppSnapshot,
  AgentActivitySource,
  BlockingMode,
  CodexActivity,
  CodexActivitySession,
  CodexActivityState,
  AgentActivityProvider,
  CompleteCustomPetGenerationInput,
  CompleteCustomPetGenerationResult,
  CreateCustomPetGenerationInput,
  CreatedCustomPetGenerationJob,
  CustomPetAsset,
  CustomPetJobSummary,
  CustomPetLibrary,
  CustomPetManifest,
  DistractionStatus,
  DemoTrigger,
  PetFacing,
  PetSlotId,
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
  clearAppleCalendarMeetingCache,
  isAppleCalendarPermissionError,
  readAppleCalendarMeetings
} from "./appleCalendar";
import { parseIcsZoomMeetings } from "./icsCalendar";
import type { CalendarMeeting } from "./icsCalendar";
import { readZoomMeetingCache } from "./zoomMeetingCache";
import {
  buildApplicationMenuTemplate,
  buildPetContextMenuTemplate,
  buildTrayMenuTemplate
} from "./menus";
import { createTrayImage } from "./trayIcon";
import { normalizeCustomPetBundle } from "./customPetGif";
import { createCustomPetJob, reconcileCustomPetJob } from "./customPetJobs";
import { createCustomPetStore, type CustomPetStore } from "./customPetStore";
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
import { readZoomShareStatus } from "./zoomShare";

type StoreSchema = {
  settings: Settings;
  stats: TodayStats;
  statsHistory: StatsHistory;
  petPosition?: SavedWindowPosition;
  secondaryPetPosition?: SavedWindowPosition;
  petScale?: number;
  petHiddenByUser?: boolean;
};

type SettingsCopy = ReturnType<typeof i18n>["settings"];
const ZOOM_SHARE_CHECK_INTERVAL_MS = 2_500;
// Return-leg speed sits at the top of the wander speed range (3.5-6.4 px/tick) so the
// run home reads as the same gait; the cap bounds the leg even across a huge display.
const BREAK_RUN_RETURN_SPEED = 6.4;
const BREAK_RUN_RETURN_MAX_MS = 5_000;
const ZOOM_MEETING_CHECK_INTERVAL_MS = 60_000;
const ZOOM_MEETING_ICS_CACHE_MS = 5 * 60 * 1000;
const ZOOM_MEETING_HORIZON_MS = 12 * 60 * 60 * 1000;
const ZOOM_MEETING_START_GRACE_MS = 10 * 60 * 1000;
const ZOOM_MEETING_BUBBLE_MS = 10 * 60 * 1000;
const REMINDER_BUSY_RETRY_MS = 5 * 60 * 1000;

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
let customPetStore: CustomPetStore | null = null;
let customPetLibrary: CustomPetLibrary = {
  updatedAt: Date.now(),
  manifests: {},
  jobs: {}
};

let petWindow: BrowserWindow | null = null;
let secondaryPetWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let petState: PetState = "idle";
let petFacing: PetFacing = "right";
let secondaryPetFacing: PetFacing = "right";
let blockingMode: BlockingMode = null;
let focusActive = false;
let focusStartedAt: number | null = null;
let breakRunTimer: NodeJS.Timeout | null = null;
let breakRunCountdownTimer: NodeJS.Timeout | null = null;
let breakRunMovementTimer: NodeJS.Timeout | null = null;
let breakRunReturnTimer: NodeJS.Timeout | null = null;
let breakRunReturnSafetyTimer: NodeJS.Timeout | null = null;
let breakRunOrigin: PetPosition | null = null;
let breakTimer: NodeJS.Timeout | null = null;
let hydrationTimer: NodeJS.Timeout | null = null;
let focusTimer: NodeJS.Timeout | null = null;
let distractionTimer: NodeJS.Timeout | null = null;
let distractionStartupTimer: NodeJS.Timeout | null = null;
let zoomShareTimer: NodeJS.Timeout | null = null;
let zoomMeetingTimer: NodeJS.Timeout | null = null;
let displayChangeTimer: NodeJS.Timeout | null = null;
let codexActivityTimer: NodeJS.Timeout | null = null;
let codexSessionFilesCache: {
  loadedAt: number;
  files: Array<{ path: string; mtimeMs: number }>;
} | null = null;
let breakDueAt: number | null = null;
let hydrationDueAt: number | null = null;
let focusEndsAt: number | null = null;
let bubbleTimer: NodeJS.Timeout | null = null;
let dragTimer: NodeJS.Timeout | null = null;
let dragSafetyTimer: NodeJS.Timeout | null = null;
let resizeTimer: NodeJS.Timeout | null = null;
let resizeSafetyTimer: NodeJS.Timeout | null = null;
let quitAnimationTimer: NodeJS.Timeout | null = null;
let breakMuteResetTimer: NodeJS.Timeout | null = null;
let breakRunVelocity: PetPosition = { x: 0, y: 0 };
let breakRunFormatter: ((seconds: number) => string) | null = null;
let nextBreakRunTurnAt = 0;
let breakMutedToday = false;
let breakMutedDate: string | null = null;
let dragOffset: PetPosition = { x: 0, y: 0 };
let dragSlot: PetSlotId = "primary";
let petScale = normalizePetScale(store.get("petScale"));
let petMouseInteractive = true;
let secondaryPetMouseInteractive = true;
let quitAnimationRunning = false;
let quitAfterAnimation = false;
let zoomShareAutoHidden = false;
let zoomShareRestorePrimary = false;
let zoomShareRestoreSecondary = false;
let zoomSharePermissionHintShown = false;
let zoomMeetingIcsCache: { url: string; fetchedAt: number; meetings: CalendarMeeting[] } | null = null;
let zoomMeetingAlerted = new Set<string>();
let zoomMeetingJoinActions = new Map<string, string>();
let zoomMeetingActionCounter = 0;
let zoomMeetingIcsErrorShown = false;
let zoomMeetingAppleErrorShown = false;
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
  slot: PetSlotId;
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

function cursorAppDataRoot(): string {
  return join(app.getPath("appData"), "Cursor");
}

function cursorLogsRoot(): string {
  return join(cursorAppDataRoot(), "logs");
}

function cursorGlobalStatePath(): string {
  return join(cursorAppDataRoot(), "User", "globalStorage", "state.vscdb");
}

let agentActivities: Record<AgentActivityProvider, CodexActivity> = {
  codex: {
    state: "idle",
    message: null,
    updatedAt: null,
    path: codexActivityPath(),
    provider: "codex",
    source: "manual",
    sessions: []
  },
  "claude-code": {
    state: "idle",
    message: null,
    updatedAt: null,
    path: claudeProjectsRoot(),
    provider: "claude-code",
    source: "manual",
    sessions: []
  },
  "claude-desktop": {
    state: "idle",
    message: null,
    updatedAt: null,
    path: claudeProjectsRoot(),
    provider: "claude-desktop",
    source: "manual",
    sessions: []
  },
  cursor: {
    state: "idle",
    message: null,
    updatedAt: null,
    path: cursorLogsRoot(),
    provider: "cursor",
    source: "manual",
    sessions: []
  }
};

const CODEX_SESSION_TAIL_BYTES = 256 * 1024;
const CODEX_SESSION_POLL_MS = 1000;
const CODEX_SESSION_FILE_CACHE_MS = 10 * 1000;
const CODEX_DESKTOP_BUNDLE_ID = "com.openai.codex";
const CLAUDE_DESKTOP_BUNDLE_ID = "com.anthropic.claudefordesktop";
const CLAUDE_CODE_TERMINAL_PROCESSES = [
  "Terminal",
  "iTerm2",
  "Warp",
  "Ghostty",
  "WezTerm",
  "kitty",
  "Alacritty",
  "Code",
  "Visual Studio Code",
  "Cursor"
];
const CLAUDE_CODE_TERMINAL_BUNDLES = [
  "com.mitchellh.ghostty",
  "dev.warp.Warp-Stable",
  "com.googlecode.iterm2",
  "com.apple.Terminal",
  "com.github.wez.wezterm",
  "net.kovidgoyal.kitty",
  "org.alacritty"
];
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
    thread_source?: string;
    source?: unknown;
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
  bridgeSessionId?: string;
  lastPrompt?: string;
  aiTitle?: string;
  customTitle?: string;
  agentId?: string;
  result?: {
    status?: string;
    summary?: string;
    issues?: unknown[];
  };
  cwd?: string;
  entrypoint?: string;
  timestamp?: string;
  summary?: string;
  title?: string;
  name?: string;
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

function agentActivityFreshMs(): number {
  return getSettings().agentActivityRetentionMinutes * 60 * 1000;
}

function codexActivityFreshMs(_state: CodexActivityState): number {
  return agentActivityFreshMs();
}

function setPetMouseInteractive(slot: PetSlotId, interactive: boolean): void {
  const win = petWindowForSlot(slot);
  const current = slot === "primary" ? petMouseInteractive : secondaryPetMouseInteractive;
  if (!win || win.isDestroyed() || current === interactive) return;
  if (slot === "primary") petMouseInteractive = interactive;
  else secondaryPetMouseInteractive = interactive;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
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
    zoomShareTimer,
    zoomMeetingTimer,
    displayChangeTimer,
    codexActivityTimer,
    bubbleTimer,
    dragTimer,
    dragSafetyTimer,
    resizeTimer,
    resizeSafetyTimer,
    breakMuteResetTimer
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
  zoomShareTimer = null;
  zoomMeetingTimer = null;
  displayChangeTimer = null;
  codexActivityTimer = null;
  bubbleTimer = null;
  dragTimer = null;
  dragSafetyTimer = null;
  resizeTimer = null;
  resizeSafetyTimer = null;
  breakMuteResetTimer = null;
}

function getSettings(): Settings {
  return getStoredSettings(store);
}

function text(): ReturnType<typeof i18n> {
  return i18n(getSettings().language);
}

function emptyAgentActivity(provider: AgentActivityProvider = "codex"): CodexActivity {
  return {
    state: "idle",
    message: null,
    updatedAt: null,
    path:
      provider === "claude-code" || provider === "claude-desktop"
        ? claudeProjectsRoot()
        : provider === "cursor"
          ? cursorLogsRoot()
          : codexActivityPath(),
    provider,
    source: "manual",
    sessions: []
  };
}

function isAgentActivityProvider(value: AgentActivitySource): value is AgentActivityProvider {
  return value === "codex" || value === "claude-code" || value === "claude-desktop" || value === "cursor";
}

function agentSourceForSlot(slot: PetSlotId): AgentActivitySource {
  const settings = getSettings();
  if (slot === "secondary") return settings.dualAgentModeEnabled ? settings.secondaryAgentSource : "none";
  return settings.primaryAgentSource;
}

function activeAgentProviders(): AgentActivityProvider[] {
  const settings = getSettings();
  const sources = new Set<AgentActivityProvider>();
  if (isAgentActivityProvider(settings.primaryAgentSource)) sources.add(settings.primaryAgentSource);
  if (settings.dualAgentModeEnabled && isAgentActivityProvider(settings.secondaryAgentSource)) {
    sources.add(settings.secondaryAgentSource);
  }
  return Array.from(sources);
}

function setSettings(next: Settings): void {
  const normalized = normalizeSettings(next);
  applyLaunchAtLoginPreference(normalized.launchAtLoginEnabled);
  store.set("settings", normalized);
  sendToAll("settings:updated", getSettingsWithSystemState());
  settingsWindow?.setTitle(`${APP_NAME} ${text().menu.settings}`);
  scheduleReminderTimers();
  scheduleDistractionDetection();
  scheduleZoomShareAutoHide();
  scheduleZoomMeetingReminders();
  syncPetWindowsForSettings();
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

function msUntilNextLocalDay(): number {
  const now = new Date();
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 0, 0);
  return Math.max(1000, nextDay.getTime() - now.getTime());
}

function clearBreakMuteResetTimer(): void {
  if (breakMuteResetTimer) clearTimeout(breakMuteResetTimer);
  breakMuteResetTimer = null;
}

function resetExpiredBreakMute(): boolean {
  if (!breakMutedToday) return false;
  if (breakMutedDate === todayKey()) return false;
  breakMutedToday = false;
  breakMutedDate = null;
  clearBreakMuteResetTimer();
  return true;
}

function scheduleBreakMuteReset(): void {
  clearBreakMuteResetTimer();
  if (!breakMutedToday) return;
  breakMuteResetTimer = setTimeout(() => {
    breakMutedToday = false;
    breakMutedDate = null;
    breakMuteResetTimer = null;
    scheduleReminderTimers();
  }, msUntilNextLocalDay());
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
  breakMutedDate = null;
  clearBreakMuteResetTimer();
  const reset = resetCurrentStats(store);
  sendToAll("stats:updated", reset);
  scheduleReminderTimers();
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

function customPetSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || "custom-pet";
}

function isSafeCustomPetId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

function buildCustomPetGenerationPrompt(input: CreateCustomPetGenerationInput, sourceDir: string): string {
  const userPrompt = input.prompt.trim();
  const displayName = input.displayName.trim() || "Custom Pet";
  return [
    "# PawPal Custom Pet Generation",
    "",
    `Pet name: ${displayName}`,
    "",
    "User prompt:",
    userPrompt,
    "",
    "Required workflow:",
    "- Read and follow the local hatch-pet skill before producing assets:",
    "  /Users/ffeng/.codex/skills/hatch-pet/SKILL.md",
    "- Use hatch-pet's visual-generation and visual-QA approach: establish one canonical base identity, generate state poses from that identity, inspect a contact sheet, and reject identity/style drift.",
    "- Adapt hatch-pet output to PawPal's separate-GIF state contract below; do not create Codex's 9-row atlas unless it is only an intermediate visual planning aid.",
    "- Do not hand-draw the character with Python, canvas, SVG, or procedural shapes. Code may only be used for deterministic file assembly, conversion, validation, contact sheets, and copying outputs.",
    "- If real visual generation is unavailable, stop and report that generation is blocked instead of creating placeholder art.",
    "",
    "Create transparent animated GIFs for PawPal. Output exactly one GIF per state directly in this folder:",
    sourceDir,
    "",
    "Required filenames:",
    ...PET_STATE_ORDER.map((state) => `- ${state}.gif`),
    "",
    "Strict requirements:",
    "- preserve one consistent character identity across every state",
    "- transparent background, no labels, no grid, no shadow plate",
    "- animated GIF, at least 2 frames per state",
    "- keep the pet compact and readable at desktop-pet size",
    "- do not write final pet.json or normalized assets; PawPal will validate and normalize"
  ].join("\n");
}

async function refreshCustomPetLibrary(): Promise<CustomPetLibrary> {
  if (!customPetStore) return customPetLibrary;
  customPetLibrary = await customPetStore.rebuildIndex();
  publishSnapshot();
  return customPetLibrary;
}

async function createCustomPetGenerationJob(
  input: CreateCustomPetGenerationInput
): Promise<CreatedCustomPetGenerationJob | null> {
  if (!customPetStore) return null;
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return null;
  const petId = `${customPetSlug(displayName || prompt)}-${Date.now().toString(36)}`;
  const sourceDir = join(customPetStore.rootDir, petId, "source");
  const promptText = buildCustomPetGenerationPrompt({ displayName, prompt }, sourceDir);
  const job = await createCustomPetJob({
    customPetsRoot: customPetStore.rootDir,
    petId,
    displayName: displayName || "Custom Pet",
    prompt: promptText,
    cwd: process.cwd()
  });
  await refreshCustomPetLibrary();
  return { ...job, promptText };
}

function summarizeCustomPetJob(job: Awaited<ReturnType<typeof reconcileCustomPetJob>>): CustomPetJobSummary {
  return {
    petId: job.petId,
    generationId: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    states: Object.fromEntries(
      job.states.map((state) => [
        state.state,
        {
          state: state.state,
          status: state.status,
          sourceRelativePath: state.sourceRelativePath ?? (
            state.sourcePath ? `custom_pets/${job.petId}/source/${state.state}.gif` : undefined
          ),
          normalizedRelativePath: state.normalizedRelativePath,
          error: state.error
        }
      ])
    ) as CustomPetJobSummary["states"]
  };
}

async function writeCustomPetJobJson(job: Awaited<ReturnType<typeof reconcileCustomPetJob>>): Promise<void> {
  await writeFile(job.jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

async function completeCustomPetGenerationJob(
  input: CompleteCustomPetGenerationInput
): Promise<CompleteCustomPetGenerationResult> {
  if (!customPetStore || typeof input.petId !== "string" || !isSafeCustomPetId(input.petId)) {
    return { manifest: null, job: null, errors: ["Invalid custom pet id."] };
  }

  const now = Date.now();
  const jobPath = join(customPetStore.rootDir, input.petId, "job.json");
  const reconciled = await reconcileCustomPetJob(jobPath, now);
  if (reconciled.status !== "complete") {
    customPetLibrary = await customPetStore.rebuildIndex();
    publishSnapshot();
    return {
      manifest: null,
      job: summarizeCustomPetJob(reconciled),
      errors: [`Missing required GIFs. Expected all 15 files in ${reconciled.sourceDir}.`]
    };
  }

  const normalized = await normalizeCustomPetBundle({
    userDataPath: app.getPath("userData"),
    petId: reconciled.petId,
    generationId: reconciled.id
  });

  if (!normalized.ok) {
    const errorsByState = new Map(normalized.stateErrors.map((item) => [item.state, item.message]));
    const failedJob = {
      ...reconciled,
      status: "error" as const,
      updatedAt: now,
      states: reconciled.states.map((state) => ({
        ...state,
        status: errorsByState.has(state.state) ? "error" as const : state.status,
        error: errorsByState.get(state.state) ?? state.error
      }))
    };
    await writeCustomPetJobJson(failedJob);
    await refreshCustomPetLibrary();
    return {
      manifest: null,
      job: summarizeCustomPetJob(failedJob),
      errors: normalized.stateErrors.map((item) => `${item.state}: ${item.message}`)
    };
  }

  const manifest: CustomPetManifest = {
    id: reconciled.petId,
    name: reconciled.displayName,
    status: "complete",
    generationId: reconciled.id,
    createdAt: reconciled.createdAt,
    updatedAt: now,
    assets: Object.fromEntries(
      PET_STATE_ORDER.map((state) => [
        state,
        {
          relativePath: normalized.outputs[state]!.relativePath,
          originalName: `${state}.gif`,
          updatedAt: now
        }
      ])
    ) as CustomPetManifest["assets"]
  };
  const completedJob = {
    ...reconciled,
    status: "complete" as const,
    updatedAt: now,
    states: reconciled.states.map((state) => ({
      ...state,
      status: "complete" as const,
      updatedAt: state.updatedAt ?? now,
      error: null,
      sourceRelativePath: normalized.outputs[state.state]?.sourceRelativePath,
      normalizedRelativePath: normalized.outputs[state.state]?.relativePath
    }))
  };
  await writeCustomPetJobJson(completedJob);
  await customPetStore.saveManifest(manifest);
  customPetLibrary = await customPetStore.rebuildIndex();
  publishSnapshot();
  return { manifest, job: summarizeCustomPetJob(completedJob), errors: [] };
}

function petWindowForSlot(slot: PetSlotId): BrowserWindow | null {
  return slot === "primary" ? petWindow : secondaryPetWindow;
}

function petSlotForWebContents(sender: Electron.WebContents): PetSlotId {
  if (secondaryPetWindow && !secondaryPetWindow.isDestroyed() && sender.id === secondaryPetWindow.webContents.id) {
    return "secondary";
  }
  return "primary";
}

function petFacingForSlot(slot: PetSlotId): PetFacing {
  return slot === "primary" ? petFacing : secondaryPetFacing;
}

function petAppearanceForSlot(slot: PetSlotId): Settings["petAppearanceId"] {
  const settings = getSettings();
  return slot === "primary" || !settings.dualAgentModeEnabled
    ? settings.petAppearanceId
    : settings.secondaryPetAppearanceId;
}

function codexActivityForSlot(slot: PetSlotId): CodexActivity {
  const source = agentSourceForSlot(slot);
  return isAgentActivityProvider(source) ? agentActivities[source] : emptyAgentActivity("codex");
}

function snapshot(slot: PetSlotId = "primary"): AppSnapshot {
  const slotWindow = petWindowForSlot(slot);
  const isPrimary = slot === "primary";
  const settings = getSettingsWithSystemState();
  return {
    appInfo: {
      version: app.getVersion(),
      releaseNotesUrl: RELEASES_URL
    },
    updateCheck,
    settings: {
      ...settings,
      petAppearanceId: petAppearanceForSlot(slot)
    },
    stats: getStats(),
    statsHistory: getStatsHistory(store),
    customPetLibrary,
    timers: {
      breakDueAt: isPrimary ? breakDueAt : null,
      hydrationDueAt: isPrimary ? hydrationDueAt : null,
      focusEndsAt: isPrimary ? focusEndsAt : null
    },
    distraction: distractionStatus,
    petState: isPrimary ? petState : "idle",
    petFacing: petFacingForSlot(slot),
    petScale,
    petSlotId: slot,
    codexActivity: codexActivityForSlot(slot),
    blockingMode: isPrimary ? blockingMode : null,
    dogVisible: Boolean(slotWindow?.isVisible()),
    focusActive: isPrimary ? focusActive : false
  };
}

function isPetHiddenByUser(): boolean {
  return store.get("petHiddenByUser") === true;
}

function setPetHiddenByUser(hidden: boolean): void {
  store.set("petHiddenByUser", hidden);
  updateTrayMenu();
  publishSnapshot();
}

function sendToPet<T>(slot: PetSlotId, channel: string, payload?: T): void {
  const win = petWindowForSlot(slot);
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function sendToAll<T>(channel: string, payload?: T): void {
  sendToPet("primary", channel, payload);
  sendToPet("secondary", channel, payload);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, payload);
  }
}

function publishSnapshot(): void {
  sendToPet("primary", "app:snapshot", snapshot("primary"));
  sendToPet("secondary", "app:snapshot", snapshot("secondary"));
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("app:snapshot", snapshot("primary"));
  }
}

function setPetState(next: PetState): void {
  petState = next;
  sendToPet("primary", "pet:set-state", next);
  publishSnapshot();
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

function normalizeAgentActivityProvider(value: unknown): AgentActivityProvider {
  if (value === "claude") return "claude-code";
  if (value === "claude-code" || value === "claude-desktop" || value === "cursor") return value;
  return "codex";
}

function normalizeCodexActivity(value: unknown): CodexActivity {
  const path = codexActivityPath();
  if (!value || typeof value !== "object") {
    return { state: "idle", message: null, updatedAt: null, path, provider: "codex", source: "manual", sessions: [] };
  }
  const source = value as Partial<CodexActivity>;
  const state = isCodexActivityState(source.state) ? source.state : "idle";
  const provider = normalizeAgentActivityProvider(source.provider);
  const rawActivitySource = (source as { source?: unknown }).source;
  const activitySource = (() => {
    if (rawActivitySource === "claude-session") return "claude-code-session";
    if (
      rawActivitySource === "codex-session" ||
      rawActivitySource === "claude-code-session" ||
      rawActivitySource === "claude-desktop-session" ||
      rawActivitySource === "cursor-session"
    ) {
      return rawActivitySource;
    }
    return "manual";
  })();
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
    path:
      provider === "claude-code" || provider === "claude-desktop"
        ? claudeProjectsRoot()
        : provider === "cursor"
          ? cursorLogsRoot()
          : path,
    provider,
    source: activitySource,
    sessions
  };
}

function setAgentActivity(provider: AgentActivityProvider, next: CodexActivity): void {
  const current = agentActivities[provider];
  const changed =
    current.state !== next.state ||
    current.message !== next.message ||
    current.updatedAt !== next.updatedAt ||
    current.path !== next.path ||
    current.provider !== next.provider ||
    current.source !== next.source ||
    JSON.stringify(current.sessions) !== JSON.stringify(next.sessions);
  if (!changed) return;
  agentActivities = { ...agentActivities, [provider]: next };
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
  const source = agentSourceForSlot("primary");
  const provider = isAgentActivityProvider(source) ? source : "codex";
  const next: CodexActivity = {
    state,
    message,
    updatedAt: Date.now(),
    path:
      provider === "claude-code" || provider === "claude-desktop"
        ? claudeProjectsRoot()
        : provider === "cursor"
          ? cursorLogsRoot()
          : codexActivityPath(),
    provider,
    source: "manual",
    sessions: []
  };
  if (provider === "codex") await writeCodexActivityFile(next);
  setAgentActivity(provider, next);
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
    try {
      const entryStat = await stat(entryPath);
      files.push({ path: entryPath, mtimeMs: entryStat.mtimeMs });
    } catch {
      // Session logs can rotate while Codex is writing.
    }
  }
  return files;
}

async function findCachedCodexSessionFiles(): Promise<Array<{ path: string; mtimeMs: number }>> {
  const now = Date.now();
  if (codexSessionFilesCache && now - codexSessionFilesCache.loadedAt <= CODEX_SESSION_FILE_CACHE_MS) {
    return codexSessionFilesCache.files;
  }

  const files = await findCodexSessionFiles(codexSessionsRoot());
  codexSessionFilesCache = { loadedAt: now, files };
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

async function findFilesNamed(directory: string, fileName: string): Promise<Array<{ path: string; mtimeMs: number }>> {
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
      files.push(...(await findFilesNamed(entryPath, fileName)));
      continue;
    }
    if (!entry.isFile() || entry.name !== fileName) continue;
    try {
      const entryStat = await stat(entryPath);
      files.push({ path: entryPath, mtimeMs: entryStat.mtimeMs });
    } catch {
      // Logs can rotate while Cursor is writing.
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

function isUserCodexSession(events: CodexSessionEvent[]): boolean {
  const meta = events.find((event) => event.type === "session_meta")?.payload;
  if (!meta) return true;
  if (meta.thread_source === "subagent") return false;
  return !(meta.source && typeof meta.source === "object" && "subagent" in meta.source);
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
  if (!isUserCodexSession(events)) return null;

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
  source: "codex-session" | "claude-code-session" | "claude-desktop-session" | "cursor-session"
): CodexActivity {
  const path =
    provider === "claude-code" || provider === "claude-desktop"
      ? claudeProjectsRoot()
      : provider === "cursor"
        ? cursorLogsRoot()
        : codexActivityPath();
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
  const freshMs = agentActivityFreshMs();
  const files = (await findCachedCodexSessionFiles())
    .filter((file) => Date.now() - file.mtimeMs <= freshMs)
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
  if (event.type === "bridge-session") return "working";
  if (event.type === "started") return "working";
  if (event.type === "result") {
    const status = event.result?.status?.toLowerCase();
    return status === "fail" || status === "failed" || status === "error" ? "error" : "complete";
  }
  if (event.type === "last-prompt" && compactCodexText(event.lastPrompt ?? null)) return "working";
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
  if (event.type === "bridge-session") return labels.codexWorkingMessage;
  if (event.type === "started") return labels.codexWorkingMessage;
  if (event.type === "result") {
    const status = event.result?.status?.toLowerCase();
    if (status === "fail" || status === "failed" || status === "error") return labels.codexBlocked;
    return labels.codexWaitingForNextPrompt;
  }
  if (event.type === "last-prompt" && compactCodexText(event.lastPrompt ?? null)) return labels.codexReadingPrompt;

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
    const title = compactCodexText(
      firstString([event.title, event.aiTitle, event.customTitle, event.summary, event.name, event.lastPrompt]),
      42
    );
    if (title) return title;
  }
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type !== "user") continue;
    const title = textFromClaudeContent(events[index].message?.content);
    if (title) return title;
  }
  return basename(filePath, extname(filePath));
}

type ClaudeActivityProvider = Extract<AgentActivityProvider, "claude-code" | "claude-desktop">;

function idForClaudeSession(events: ClaudeSessionEvent[], filePath: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const sessionId = events[index].sessionId;
    if (sessionId) return sessionId;
  }
  const parentSessionId = filePath.match(/\/([0-9a-f-]{36})\/subagents\//i)?.[1];
  return parentSessionId ?? basename(filePath, extname(filePath));
}

function coalesceClaudeSessions(sessions: CodexActivitySession[]): CodexActivitySession[] {
  const byId = new Map<string, CodexActivitySession>();
  for (const session of sessions) {
    const existing = byId.get(session.id);
    if (!existing || session.updatedAt >= existing.updatedAt) {
      byId.set(session.id, session);
    }
  }
  return Array.from(byId.values());
}

function isClaudeDesktopSession(events: ClaudeSessionEvent[]): boolean {
  return events.some((event) => event.entrypoint?.toLowerCase() === "claude-desktop");
}

function claudeSessionMatchesProvider(events: ClaudeSessionEvent[], provider: ClaudeActivityProvider): boolean {
  const desktopSession = isClaudeDesktopSession(events);
  return provider === "claude-desktop" ? desktopSession : !desktopSession;
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

async function inferClaudeSessionFileActivity(
  file: {
    path: string;
    mtimeMs: number;
  },
  provider: ClaudeActivityProvider
): Promise<CodexActivitySession | null> {
  const labels = text().settings;
  const [head, tail] = await Promise.all([
    readFileHead(file.path, 64 * 1024),
    readFileTail(file.path, CODEX_SESSION_TAIL_BYTES)
  ]);
  const events = parseClaudeSessionEvents(`${head}\n${tail}`);
  if (!claudeSessionMatchesProvider(events, provider)) return null;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const state = stateForClaudeSessionEvent(event);
    if (!state) continue;

    const updatedAt = event.timestamp ? Date.parse(event.timestamp) : file.mtimeMs;
    if (!Number.isFinite(updatedAt)) return null;
    if (Date.now() - updatedAt > codexActivityFreshMs(state)) return null;

    const id = idForClaudeSession(events, file.path);
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

async function inferClaudeSessionActivity(provider: ClaudeActivityProvider): Promise<CodexActivity | null> {
  const freshMs = agentActivityFreshMs();
  const files = (await findCodexSessionFiles(claudeProjectsRoot()))
    .filter((file) => Date.now() - file.mtimeMs <= freshMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 50);
  if (!files.length) return null;

  const sessions = coalesceClaudeSessions(
    (await Promise.all(files.map((file) => inferClaudeSessionFileActivity(file, provider))))
      .filter((session): session is CodexActivitySession => Boolean(session))
  );
  if (!sessions.length) return null;
  const titles = provider === "claude-code"
    ? await readClaudeCodeSessionTitles(new Set(sessions.map((session) => session.id)))
    : new Map<string, string>();
  const titledSessions = sessions.map((session) => ({
    ...session,
    title: titles.get(session.id) ?? session.title
  }));
  return aggregateSessionActivity(
    titledSessions,
    text().settings,
    provider,
    provider === "claude-code" ? "claude-code-session" : "claude-desktop-session"
  );
}

type CursorComposerHeader = {
  composerId?: string;
  name?: string;
  subtitle?: string;
  lastUpdatedAt?: number;
  conversationCheckpointLastUpdatedAt?: number;
  createdAt?: number;
  workspaceIdentifier?: {
    uri?: {
      fsPath?: string;
      path?: string;
    };
  };
};

type CursorComposerHeadersPayload = {
  allComposers?: CursorComposerHeader[];
};

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolveText, rejectText) => {
    execFile(command, args, { maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        rejectText(error);
        return;
      }
      resolveText(stdout);
    });
  });
}

function parseCursorComposerHeaders(raw: string): Map<string, CursorComposerHeader> {
  const parsed = JSON.parse(raw) as CursorComposerHeadersPayload;
  const headers = new Map<string, CursorComposerHeader>();
  for (const composer of parsed.allComposers ?? []) {
    if (typeof composer.composerId === "string") headers.set(composer.composerId, composer);
  }
  return headers;
}

function extractJsonObjectAroundMarker(textValue: string, marker: string): string | null {
  const markerIndex = textValue.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = textValue.lastIndexOf("{", markerIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < textValue.length; index += 1) {
    const char = textValue[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return textValue.slice(start, index + 1);
    }
  }
  return null;
}

async function readCursorComposerHeaders(): Promise<Map<string, CursorComposerHeader>> {
  const dbPath = cursorGlobalStatePath();
  try {
    const sqlitePath = process.platform === "darwin" ? "/usr/bin/sqlite3" : "sqlite3";
    const raw = await execFileText(sqlitePath, [
      "-readonly",
      dbPath,
      "select value from ItemTable where key='composer.composerHeaders';"
    ]);
    if (raw.trim()) return parseCursorComposerHeaders(raw);
  } catch {
    // Keep a raw SQLite-file fallback for machines without sqlite3 on PATH.
  }

  try {
    const raw = await readFile(dbPath, "utf8");
    const json = extractJsonObjectAroundMarker(raw, "\"allComposers\"");
    if (!json) return new Map();
    return parseCursorComposerHeaders(json);
  } catch {
    return new Map();
  }
}

function parseCursorLogTimestamp(line: string): number | null {
  const timestamp = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/)?.[1];
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : null;
}

function cursorComposerTitle(composerId: string, header: CursorComposerHeader | undefined): string {
  const title = compactCodexText(header?.name ?? null, 48);
  if (title) return title;
  const workspacePath = header?.workspaceIdentifier?.uri?.fsPath ?? header?.workspaceIdentifier?.uri?.path;
  if (workspacePath) return basename(workspacePath);
  return `Cursor ${composerId.slice(0, 8)}`;
}

function cursorComposerMessage(
  state: CodexActivityState,
  header: CursorComposerHeader | undefined,
  labels: SettingsCopy
): string | null {
  if (state === "working") return labels.codexWorkingMessage;
  if (state === "complete") return labels.codexWaitingForNextPrompt;
  return compactCodexText(header?.subtitle ?? null, 72);
}

async function inferCursorSessionActivity(): Promise<CodexActivity | null> {
  const freshMs = agentActivityFreshMs();
  const files = (await findFilesNamed(cursorLogsRoot(), "renderer.log"))
    .filter((file) => Date.now() - file.mtimeMs <= freshMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 20);
  if (!files.length) return null;

  const latestByComposer = new Map<string, { state: CodexActivityState; updatedAt: number; path: string }>();
  for (const file of files) {
    const raw = await readFileTail(file.path, CODEX_SESSION_TAIL_BYTES);
    for (const line of raw.split("\n")) {
      if (!line.includes("ComposerWakelockManager") || !line.includes("composerId=")) continue;
      const composerId = line.match(/composerId=([0-9a-f-]{36})/i)?.[1];
      const updatedAt = parseCursorLogTimestamp(line) ?? file.mtimeMs;
      if (!composerId || Date.now() - updatedAt > freshMs) continue;

      let state: CodexActivityState | null = null;
      if (line.includes("Acquired wakelock") || line.includes("Disabled background throttling")) {
        state = "working";
      }
      if (line.includes("Released wakelock") || line.includes("Restored background throttling")) {
        state = "complete";
      }
      if (!state) continue;

      const existing = latestByComposer.get(composerId);
      if (!existing || updatedAt >= existing.updatedAt) {
        latestByComposer.set(composerId, { state, updatedAt, path: file.path });
      }
    }
  }
  if (!latestByComposer.size) return null;

  const labels = text().settings;
  const headers = await readCursorComposerHeaders();
  const sessions = Array.from(latestByComposer, ([composerId, latest]) => {
    const header = headers.get(composerId);
    return {
      id: composerId,
      title: cursorComposerTitle(composerId, header),
      state: latest.state,
      message: cursorComposerMessage(latest.state, header, labels),
      updatedAt: latest.updatedAt,
      path: latest.path
    } satisfies CodexActivitySession;
  });

  return aggregateSessionActivity(sessions, labels, "cursor", "cursor-session");
}

async function pollAgentActivity(provider: AgentActivityProvider): Promise<void> {
  let stored: CodexActivity | null = null;
  let inferred: CodexActivity | null = null;
  if (provider === "codex") {
    [stored, inferred] = await Promise.all([
      readStoredCodexActivity(),
      inferCodexSessionActivity()
    ]);
  } else {
    inferred =
      provider === "claude-code" || provider === "claude-desktop"
        ? await inferClaudeSessionActivity(provider)
        : await inferCursorSessionActivity();
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
    setAgentActivity(provider, next);
    return;
  }

  setAgentActivity(provider, emptyAgentActivity(provider));
}

async function pollCodexActivity(): Promise<void> {
  const providers = activeAgentProviders();
  await Promise.all(
    (["codex", "claude-code", "claude-desktop", "cursor"] as const).map(async (provider) => {
      if (!providers.includes(provider)) {
        setAgentActivity(provider, emptyAgentActivity(provider));
        return;
      }
      await pollAgentActivity(provider);
    })
  );
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
  sendToPet("primary", "pet:show-bubble", bubble);
  if (bubble.autoDismissMs) {
    bubbleTimer = setTimeout(() => hideBubble(), bubble.autoDismissMs);
  }
}

function hideBubble(): void {
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
  sendToPet("primary", "pet:hide-bubble");
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

function defaultSecondaryPetBounds(): Electron.Rectangle {
  const displays = currentDisplays();
  const primary = primaryDisplay();
  const display = displays.find((candidate) => candidate.id !== primary.id) ?? primary;
  const size = petWindowSize();
  return visibleWindowBounds(currentDisplays(), primary, {
    width: size.width,
    height: size.height,
    x: display.workArea.x + display.workArea.width - size.width - 24,
    y: display.workArea.y + display.workArea.height - size.height - 24
  });
}

function initialPetBounds(slot: PetSlotId = "primary"): Electron.Rectangle {
  const stored = slot === "primary" ? store.get("petPosition") : store.get("secondaryPetPosition");
  if (slot === "secondary" && !stored) return defaultSecondaryPetBounds();
  return initialWindowBounds({
    displays: currentDisplays(),
    primaryDisplay: primaryDisplay(),
    size: petWindowSize(),
    saved: stored
  });
}

function persistPetPosition(slot: PetSlotId = "primary"): void {
  const win = petWindowForSlot(slot);
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  store.set(
    slot === "primary" ? "petPosition" : "secondaryPetPosition",
    savedPositionFromBounds(currentDisplays(), bounds, primaryDisplay())
  );
}

function keepPetWindowInVisibleWorkArea(): void {
  for (const slot of ["primary", "secondary"] as const) {
    const win = petWindowForSlot(slot);
    if (!win || win.isDestroyed()) continue;
    const bounds = win.getBounds();
    const nextBounds = visibleWindowBounds(currentDisplays(), primaryDisplay(), bounds);
    if (bounds.x !== nextBounds.x || bounds.y !== nextBounds.y) {
      win.setBounds(nextBounds);
    }
    persistPetPosition(slot);
  }
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

function createPetWindow(slot: PetSlotId = "primary"): void {
  const bounds = initialPetBounds(slot);
  if (slot === "primary") petMouseInteractive = true;
  else secondaryPetMouseInteractive = true;
  const win = new BrowserWindow({
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

  if (slot === "primary") petWindow = win;
  else secondaryPetWindow = win;

  win.setAlwaysOnTop(true, process.platform === "darwin" ? "floating" : "normal");
  if (process.platform === "darwin") {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  setPetMouseInteractive(slot, false);
  loadRenderer(win, "pet");
  win.once("ready-to-show", () => {
    if (!isPetHiddenByUser()) win.showInactive();
    updateTrayMenu();
    publishSnapshot();
  });
  win.on("show", () => {
    updateTrayMenu();
    publishSnapshot();
  });
  win.on("hide", () => {
    stopPetDrag(slot);
    stopPetResize();
    updateTrayMenu();
    publishSnapshot();
  });
  win.on("closed", () => {
    stopPetDrag(slot);
    stopPetResize();
    if (slot === "primary") petWindow = null;
    else secondaryPetWindow = null;
    updateTrayMenu();
    publishSnapshot();
  });
}

function ensurePetWindowVisible(options: { ignoreUserHidden?: boolean } = {}): boolean {
  if (isPetHiddenByUser() && !options.ignoreUserHidden) {
    updateTrayMenu();
    publishSnapshot();
    return false;
  }
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  if (petWindow && !petWindow.isVisible()) petWindow.showInactive();
  updateTrayMenu();
  publishSnapshot();
  return true;
}

function showPetWindowsFromMenu(): void {
  setPetHiddenByUser(false);
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  if (petWindow && !petWindow.isVisible()) petWindow.showInactive();
  if (getSettings().dualAgentModeEnabled) {
    if (!secondaryPetWindow || secondaryPetWindow.isDestroyed()) createPetWindow("secondary");
    else if (!secondaryPetWindow.isVisible()) secondaryPetWindow.showInactive();
  }
  updateTrayMenu();
  publishSnapshot();
}

function syncPetWindowsForSettings(): void {
  const hiddenByUser = isPetHiddenByUser();
  if (getSettings().dualAgentModeEnabled) {
    if (!secondaryPetWindow || secondaryPetWindow.isDestroyed()) createPetWindow("secondary");
    else if (!hiddenByUser && !secondaryPetWindow.isVisible()) secondaryPetWindow.showInactive();
  } else if (secondaryPetWindow && !secondaryPetWindow.isDestroyed()) {
    secondaryPetWindow.close();
  }
  if (hiddenByUser) {
    petWindow?.hide();
    secondaryPetWindow?.hide();
  }
  if (zoomShareAutoHidden) {
    petWindow?.hide();
    secondaryPetWindow?.hide();
  }
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
  const shouldShow = !petWindow.isVisible();
  if (shouldShow) {
    showPetWindowsFromMenu();
    return;
  }
  setPetHiddenByUser(true);
  for (const win of [petWindow, secondaryPetWindow]) {
    if (!win || win.isDestroyed()) continue;
    win.hide();
  }
  updateTrayMenu();
  publishSnapshot();
}

function hidePetWindowFromMenu(): void {
  setPetHiddenByUser(true);
  petWindow?.hide();
  secondaryPetWindow?.hide();
  updateTrayMenu();
  publishSnapshot();
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
  secondaryPetWindow?.hide();

  if (!petWindow || petWindow.isDestroyed()) {
    finishQuitAfterAnimation();
    return;
  }

  const win = petWindow;
  if (!win.isVisible()) win.showInactive();
  setPetMouseInteractive("primary", false);
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
    dogVisible: Boolean(petWindow?.isVisible() || secondaryPetWindow?.isVisible()),
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

function showPetContextMenu(slot: PetSlotId = "primary"): void {
  const labels = text().menu;
  Menu.buildFromTemplate(buildPetContextMenuTemplate(labels, menuState(), menuActions())).popup({
    window: petWindowForSlot(slot) ?? undefined
  });
}

function movePetWithCursor(): void {
  const win = petWindowForSlot(dragSlot);
  if (!win || win.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const currentBounds = win.getBounds();
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
  win.setBounds(bounds);
}

function startPetDrag(slot: PetSlotId, offset: { offsetX: number; offsetY: number }): void {
  const win = petWindowForSlot(slot);
  if ((slot === "primary" && blockingMode === "breakRun") || !win || win.isDestroyed()) return;
  stopPetResize();
  dragSlot = slot;
  const bounds = win.getBounds();
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

function stopPetDrag(slot: PetSlotId = dragSlot): void {
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
    persistPetPosition(slot);
    publishSnapshot();
  }
}

function movePetResizeWithCursor(): void {
  if (!petResizeSession) return;
  const win = petWindowForSlot(petResizeSession.slot);
  if (!win || win.isDestroyed()) return;

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
  win.setBounds(nextBounds);
  publishSnapshot();
}

function startPetResize(slot: PetSlotId): void {
  const win = petWindowForSlot(slot);
  if ((slot === "primary" && blockingMode === "breakRun") || !win || win.isDestroyed()) return;
  stopPetDrag();
  petResizeSession = {
    slot,
    startCursor: screen.getCursorScreenPoint(),
    startBounds: win.getBounds(),
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
  const resizedSlot = petResizeSession?.slot ?? "primary";
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
    persistPetPosition(resizedSlot);
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
  if (breakRunReturnTimer) {
    clearInterval(breakRunReturnTimer);
    breakRunReturnTimer = null;
  }
  if (breakRunReturnSafetyTimer) {
    clearTimeout(breakRunReturnSafetyTimer);
    breakRunReturnSafetyTimer = null;
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

function snapPetToBreakRunOrigin(): void {
  if (!breakRunOrigin || !petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  petWindow.setBounds({ ...bounds, x: Math.round(breakRunOrigin.x), y: Math.round(breakRunOrigin.y) });
}

function movePetForBreakRunReturn(): void {
  if (!breakRunOrigin || !petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) {
    finishBreakRun();
    return;
  }
  const bounds = petWindow.getBounds();
  const dx = breakRunOrigin.x - bounds.x;
  const dy = breakRunOrigin.y - bounds.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= BREAK_RUN_RETURN_SPEED) {
    snapPetToBreakRunOrigin();
    finishBreakRun();
    return;
  }
  setPetFacing(dx >= 0 ? "right" : "left");
  petWindow.setBounds({
    ...bounds,
    x: Math.round(bounds.x + (dx / distance) * BREAK_RUN_RETURN_SPEED),
    y: Math.round(bounds.y + (dy / distance) * BREAK_RUN_RETURN_SPEED)
  });
}

function startBreakRunReturn(): void {
  if (breakRunMovementTimer) {
    clearInterval(breakRunMovementTimer);
    breakRunMovementTimer = null;
  }
  if (breakRunCountdownTimer) {
    clearInterval(breakRunCountdownTimer);
    breakRunCountdownTimer = null;
  }
  if (!breakRunOrigin || !petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) {
    finishBreakRun();
    return;
  }
  hideBubble();
  // Display layout may have changed mid-run; pull the origin back into visible space.
  const bounds = petWindow.getBounds();
  const clamped = visibleWindowBounds(currentDisplays(), primaryDisplay(), {
    x: breakRunOrigin.x,
    y: breakRunOrigin.y,
    width: bounds.width,
    height: bounds.height
  });
  breakRunOrigin = { x: clamped.x, y: clamped.y };
  breakRunReturnTimer = setInterval(movePetForBreakRunReturn, BREAK_RUN_TICK_MS);
  breakRunReturnSafetyTimer = setTimeout(() => {
    snapPetToBreakRunOrigin();
    finishBreakRun();
  }, BREAK_RUN_RETURN_MAX_MS);
}

function finishBreakRun(): void {
  clearBreakRunTimers();
  breakRunOrigin = null;
  breakRunFormatter = null;
  blockingMode = null;
  hideBubble();
  showBubble({ id: "break-run-complete", message: pick(text().bubble.breakRunComplete), autoDismissMs: 2200 });
  setPetState("breakDone");
  scheduleBreakReminderTimer();
  setTimeout(() => {
    if (!blockingMode && !focusActive) {
      if (showOverdueReminder()) return;
      hideBubble();
      setPetState("idle");
    }
  }, 2300);
  publishSnapshot();
}

function startBreakRun(): void {
  stopPetDrag();
  stopPetResize();
  ensurePetWindowVisible();
  clearBreakRunTimers();
  blockingMode = "breakRun";
  breakDueAt = null;
  breakRunFormatter = pick(text().bubble.breakRun);
  if (petWindow && !petWindow.isDestroyed()) {
    const startBounds = petWindow.getBounds();
    breakRunOrigin = { x: startBounds.x, y: startBounds.y };
  }
  breakRunVelocity = chooseBreakRunVelocity();
  nextBreakRunTurnAt = Date.now();
  setPetState("breakRunning");
  setPetFacing(breakRunVelocity.x >= 0 ? "right" : "left");
  const durationMs = getSettings().breakRunDurationSeconds * 1000;
  const endsAt = Date.now() + durationMs;
  showBreakRunCountdown(endsAt);
  breakRunCountdownTimer = setInterval(() => showBreakRunCountdown(endsAt), 1000);
  breakRunMovementTimer = setInterval(movePetForBreakRun, BREAK_RUN_TICK_MS);
  breakRunTimer = setTimeout(startBreakRunReturn, durationMs);
  publishSnapshot();
}

function clearBreakReminderTimer(): void {
  if (breakTimer) clearTimeout(breakTimer);
  breakTimer = null;
}

function clearHydrationReminderTimer(): void {
  if (hydrationTimer) clearTimeout(hydrationTimer);
  hydrationTimer = null;
}

function clearReminderTimers(): void {
  clearBreakReminderTimer();
  clearHydrationReminderTimer();
  breakDueAt = null;
  hydrationDueAt = null;
}

function scheduleReminderTimers(): void {
  clearReminderTimers();
  resetExpiredBreakMute();
  scheduleBreakMuteReset();
  scheduleBreakReminderTimer();
  scheduleHydrationReminderTimer();
}

function scheduleBreakReminderTimer(delayMs?: number): void {
  clearBreakReminderTimer();
  resetExpiredBreakMute();
  scheduleBreakMuteReset();
  const settings = getSettings();
  if (!settings.breakReminderEnabled || breakMutedToday) {
    breakDueAt = null;
    publishSnapshot();
    return;
  }

  const nextDelayMs = delayMs ?? settings.breakIntervalMinutes * 60 * 1000;
  breakDueAt = Date.now() + nextDelayMs;
  breakTimer = setTimeout(() => triggerBreakReminder(false), nextDelayMs);
  publishSnapshot();
}

function scheduleHydrationReminderTimer(delayMs?: number): void {
  clearHydrationReminderTimer();
  const settings = getSettings();
  if (!settings.hydrationReminderEnabled) {
    hydrationDueAt = null;
    publishSnapshot();
    return;
  }

  const nextDelayMs = delayMs ?? settings.hydrationIntervalMinutes * 60 * 1000;
  hydrationDueAt = Date.now() + nextDelayMs;
  hydrationTimer = setTimeout(() => triggerHydrationReminder(false), nextDelayMs);
  publishSnapshot();
}

function scheduleBreakBusyRetry(): void {
  resetExpiredBreakMute();
  if (!getSettings().breakReminderEnabled || breakMutedToday) {
    clearBreakReminderTimer();
    breakDueAt = null;
    publishSnapshot();
    return;
  }
  clearBreakReminderTimer();
  if (breakDueAt === null) breakDueAt = Date.now();
  breakTimer = setTimeout(() => triggerBreakReminder(false), REMINDER_BUSY_RETRY_MS);
  publishSnapshot();
}

function scheduleHydrationBusyRetry(): void {
  if (!getSettings().hydrationReminderEnabled) {
    clearHydrationReminderTimer();
    hydrationDueAt = null;
    publishSnapshot();
    return;
  }
  clearHydrationReminderTimer();
  if (hydrationDueAt === null) hydrationDueAt = Date.now();
  hydrationTimer = setTimeout(() => triggerHydrationReminder(false), REMINDER_BUSY_RETRY_MS);
  publishSnapshot();
}

function showOverdueReminder(): boolean {
  if (blockingMode || focusActive) return false;

  const now = Date.now();
  const settings = getSettings();
  resetExpiredBreakMute();
  if (settings.breakReminderEnabled && !breakMutedToday && breakDueAt !== null && breakDueAt <= now) {
    triggerBreakReminder(false);
    return true;
  }
  if (settings.hydrationReminderEnabled && hydrationDueAt !== null && hydrationDueAt <= now) {
    triggerHydrationReminder(false);
    return true;
  }

  return false;
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

function hidePetsForZoomShare(): void {
  if (zoomShareAutoHidden) return;
  zoomShareRestorePrimary = Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
  zoomShareRestoreSecondary = Boolean(
    secondaryPetWindow && !secondaryPetWindow.isDestroyed() && secondaryPetWindow.isVisible()
  );
  zoomShareAutoHidden = zoomShareRestorePrimary || zoomShareRestoreSecondary;
  for (const win of [petWindow, secondaryPetWindow]) {
    if (!win || win.isDestroyed() || !win.isVisible()) continue;
    win.hide();
  }
  updateTrayMenu();
  publishSnapshot();
}

function restorePetsAfterZoomShare(): void {
  if (!zoomShareAutoHidden) return;
  if (zoomShareRestorePrimary && petWindow && !petWindow.isDestroyed()) {
    petWindow.showInactive();
  }
  if (
    zoomShareRestoreSecondary &&
    getSettings().dualAgentModeEnabled &&
    secondaryPetWindow &&
    !secondaryPetWindow.isDestroyed()
  ) {
    secondaryPetWindow.showInactive();
  }
  zoomShareAutoHidden = false;
  zoomShareRestorePrimary = false;
  zoomShareRestoreSecondary = false;
  showBubble({ id: "zoom-share-restored", message: pick(text().bubble.zoomShareRestored), autoDismissMs: 1800 });
  updateTrayMenu();
  publishSnapshot();
}

async function checkZoomShareAutoHideNow(): Promise<void> {
  const settings = getSettings();
  if (!settings.zoomShareAutoHideEnabled || process.platform !== "darwin") return;
  const status = await readZoomShareStatus();
  if (status.state === "sharing") {
    hidePetsForZoomShare();
    return;
  }
  // Anything other than a positive "sharing" reading must restore the pets:
  // leaving them hidden because detection became unavailable strands them invisible.
  restorePetsAfterZoomShare();
  if (status.state === "permission-needed" && !zoomSharePermissionHintShown) {
    zoomSharePermissionHintShown = true;
    showBubble({ id: "zoom-share-permission", message: pick(text().bubble.zoomSharePermission), autoDismissMs: 3200 });
  }
}

function scheduleZoomShareAutoHide(): void {
  if (zoomShareTimer) {
    clearInterval(zoomShareTimer);
    zoomShareTimer = null;
  }
  const settings = getSettings();
  if (!settings.zoomShareAutoHideEnabled || process.platform !== "darwin") {
    restorePetsAfterZoomShare();
    return;
  }
  void checkZoomShareAutoHideNow();
  zoomShareTimer = setInterval(() => void checkZoomShareAutoHideNow(), ZOOM_SHARE_CHECK_INTERVAL_MS);
}

function normalizeIcsUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.toLowerCase().startsWith("webcal://")) return `https://${trimmed.slice("webcal://".length)}`;
  return trimmed;
}

function zoomMeetingAlertKey(meeting: CalendarMeeting, phase: "lead" | "start"): string {
  return `${meeting.uid}:${meeting.startMs}:${phase}`;
}

function zoomMeetingCachePath(): string {
  return join(app.getPath("userData"), "outlook-meetings.json");
}

function dedupeZoomMeetings(meetings: CalendarMeeting[]): CalendarMeeting[] {
  const byKey = new Map<string, CalendarMeeting>();
  for (const meeting of meetings) {
    // The same meeting arrives from multiple sources (ICS, drop file, Apple Calendar)
    // with different uids, so key on start time + Zoom meeting number instead.
    const meetingNumber = meeting.joinUrl.match(/\/j\/(\d+)/)?.[1];
    const key = `${meeting.startMs}:${meetingNumber ?? meeting.joinUrl}`;
    if (!byKey.has(key)) byKey.set(key, meeting);
  }
  return Array.from(byKey.values()).sort((left, right) => left.startMs - right.startMs);
}

async function readZoomMeetingsFromIcs(settings: Settings): Promise<CalendarMeeting[]> {
  const url = normalizeIcsUrl(settings.zoomMeetingIcsUrl);
  if (!url) return [];
  const now = Date.now();
  if (zoomMeetingIcsCache && zoomMeetingIcsCache.url === url && now - zoomMeetingIcsCache.fetchedAt < ZOOM_MEETING_ICS_CACHE_MS) {
    return zoomMeetingIcsCache.meetings;
  }
  const response = await net.fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw = await response.text();
  const meetings = parseIcsZoomMeetings(raw, now, ZOOM_MEETING_HORIZON_MS);
  zoomMeetingIcsCache = { url, fetchedAt: now, meetings };
  zoomMeetingIcsErrorShown = false;
  return meetings;
}

async function readZoomMeetings(settings: Settings): Promise<CalendarMeeting[]> {
  const meetings: CalendarMeeting[] = [];
  let icsError: unknown = null;
  if (settings.zoomMeetingIcsUrl.trim()) {
    try {
      meetings.push(...await readZoomMeetingsFromIcs(settings));
    } catch (error) {
      icsError = error;
    }
  }

  if (settings.zoomMeetingAppleCalendarEnabled && process.platform === "darwin") {
    try {
      meetings.push(...await readAppleCalendarMeetings(Date.now(), ZOOM_MEETING_HORIZON_MS));
      zoomMeetingAppleErrorShown = false;
    } catch (error) {
      if (!zoomMeetingAppleErrorShown) {
        zoomMeetingAppleErrorShown = true;
        const message = isAppleCalendarPermissionError(error)
          ? pick(text().bubble.zoomMeetingApplePermission)
          : pick(text().bubble.zoomMeetingAppleError);
        showBubble({ id: "zoom-meeting-apple-error", message, autoDismissMs: 4200 });
      }
    }
  }

  meetings.push(...await readZoomMeetingCache(zoomMeetingCachePath(), Date.now(), ZOOM_MEETING_HORIZON_MS));
  const deduped = dedupeZoomMeetings(meetings);
  if (deduped.length || !icsError) return deduped;
  throw icsError;
}

function registerZoomMeetingJoinAction(joinUrl: string): string {
  const actionId = `zoom-meeting:join:${zoomMeetingActionCounter++}`;
  zoomMeetingJoinActions.set(actionId, joinUrl);
  if (zoomMeetingJoinActions.size > 20) {
    const oldest = zoomMeetingJoinActions.keys().next().value;
    if (oldest) zoomMeetingJoinActions.delete(oldest);
  }
  return actionId;
}

function showZoomMeetingReminder(meeting: CalendarMeeting, phase: "lead" | "start", leadMinutes: number): void {
  const message =
    phase === "lead"
      ? pick(text().bubble.zoomMeetingSoon)(meeting.title, leadMinutes)
      : pick(text().bubble.zoomMeetingNow)(meeting.title);
  const joinActionId = registerZoomMeetingJoinAction(meeting.joinUrl);
  showBubble({
    id: `zoom-meeting-${phase}-${meeting.uid}-${meeting.startMs}`,
    message,
    actions: [
      { id: joinActionId, label: text().actions.joinMeeting, kind: "primary" },
      { id: "zoom-meeting:dismiss", label: text().actions.dismiss }
    ],
    autoDismissMs: ZOOM_MEETING_BUBBLE_MS
  });
}

async function checkZoomMeetingRemindersNow(): Promise<void> {
  const settings = getSettings();
  if (!settings.zoomMeetingReminderEnabled) return;
  try {
    const meetings = await readZoomMeetings(settings);
    const now = Date.now();
    const leadMs = settings.zoomMeetingReminderLeadMinutes * 60 * 1000;
    for (const meeting of meetings) {
      const leadKey = zoomMeetingAlertKey(meeting, "lead");
      const leadTarget = meeting.startMs - leadMs;
      if (leadMs > 0 && !zoomMeetingAlerted.has(leadKey) && now >= leadTarget && now < meeting.startMs) {
        zoomMeetingAlerted.add(leadKey);
        showZoomMeetingReminder(meeting, "lead", settings.zoomMeetingReminderLeadMinutes);
        return;
      }

      const startKey = zoomMeetingAlertKey(meeting, "start");
      const startReminderEndsAt = Math.min(meeting.endMs, meeting.startMs + ZOOM_MEETING_START_GRACE_MS);
      if (!zoomMeetingAlerted.has(startKey) && now >= meeting.startMs && now <= startReminderEndsAt) {
        zoomMeetingAlerted.add(startKey);
        showZoomMeetingReminder(meeting, "start", settings.zoomMeetingReminderLeadMinutes);
        return;
      }
    }
  } catch {
    if (!zoomMeetingIcsErrorShown) {
      zoomMeetingIcsErrorShown = true;
      showBubble({ id: "zoom-meeting-ics-error", message: pick(text().bubble.zoomMeetingIcsError), autoDismissMs: 4200 });
    }
  }
}

function scheduleZoomMeetingReminders(): void {
  if (zoomMeetingTimer) {
    clearInterval(zoomMeetingTimer);
    zoomMeetingTimer = null;
  }
  const settings = getSettings();
  if (!settings.zoomMeetingReminderEnabled || !settings.zoomMeetingAppleCalendarEnabled) {
    clearAppleCalendarMeetingCache();
    zoomMeetingAppleErrorShown = false;
  }
  if (!settings.zoomMeetingReminderEnabled) {
    zoomMeetingIcsCache = null;
    zoomMeetingIcsErrorShown = false;
    return;
  }
  void checkZoomMeetingRemindersNow();
  zoomMeetingTimer = setInterval(() => void checkZoomMeetingRemindersNow(), ZOOM_MEETING_CHECK_INTERVAL_MS);
}

function resumeLongTermState(): void {
  blockingMode = null;
  hideBubble();
  if (showOverdueReminder()) return;
  if (focusActive) {
    setPetState("focusGuard");
    publishSnapshot();
    return;
  }
  setPetState("idle");
  publishSnapshot();
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

function openMacBundle(bundleId: string, url?: string): Promise<void> {
  const args = url ? ["-b", bundleId, url] : ["-b", bundleId];
  return new Promise((resolveOpen, rejectOpen) => {
    execFile("/usr/bin/open", args, (error) => {
      if (error) rejectOpen(error);
      else resolveOpen();
    });
  });
}

function openMacAppByName(appName: string): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    execFile("/usr/bin/open", ["-a", appName], (error) => {
      if (error) rejectOpen(error);
      else resolveOpen();
    });
  });
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function claudeCodeOpenTitleCandidates(sessionId: string, sessionTitle?: string): string[] {
  const trackedSession = agentActivities["claude-code"].sessions.find((session) => session.id === sessionId);
  return uniqueNonEmptyStrings([sessionTitle, trackedSession?.title]);
}

function claudeCodeTerminalSearchTerms(sessionTitles: string[]): string[] {
  const terms = new Set<string>();
  for (const sessionTitle of sessionTitles) {
    const normalized = sessionTitle
      .replace(/[.…]+/g, " ")
      .replace(/[^a-zA-Z0-9/_ -]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length >= 8) {
      terms.add(normalized.slice(0, 48));
      terms.add(normalized);
    }
    const words = normalized.split(/[\s-]+/).filter((word) => word.length >= 4);
    for (let index = 0; index < words.length - 1; index += 1) {
      terms.add(`${words[index]} ${words[index + 1]}`);
    }
  }
  return Array.from(terms).filter((term) => term.length >= 8).slice(0, 8);
}

function terminalClaudeCodeFallbackTerms(): string[] {
  return ["claude code", "claude"];
}

function claudeCodeTerminalRaiseScript(sessionTitles: string[]): string {
  const processNames = CLAUDE_CODE_TERMINAL_PROCESSES.map((name) => `"${name}"`).join(", ");
  const searchTerms = claudeCodeTerminalSearchTerms(sessionTitles);
  const targetTerms = searchTerms.length ? searchTerms.map(appleScriptString).join(", ") : "";
  const fallbackTerms = terminalClaudeCodeFallbackTerms().map(appleScriptString).join(", ");
  return `
use framework "AppKit"
use scripting additions

-- AppleScript "activate" and System Events "set frontmost" raise ALL of an app's
-- windows; activateWithOptions without NSApplicationActivateAllWindows raises only
-- the app's front window, leaving its other windows at their global z-positions.
on raiseAppWindowOnly(bundleId)
  try
    set runningApps to current application's NSRunningApplication's runningApplicationsWithBundleIdentifier:bundleId
    set theApp to runningApps's firstObject()
    if theApp is not missing value then
      theApp's activateWithOptions:(current application's NSApplicationActivateIgnoringOtherApps)
      return true
    end if
  end try
  return false
end raiseAppWindowOnly

on textMatchesAny(rawText, targetTerms)
  if (count of targetTerms) is 0 then return false
  set rawTextValue to rawText as text
  ignoring case
    repeat with targetTerm in targetTerms
      set targetText to targetTerm as text
      if targetText is not "" and rawTextValue contains targetText then return true
    end repeat
  end ignoring
  return false
end textMatchesAny

set targetTerms to {${targetTerms}}
set fallbackTerms to {${fallbackTerms}}

if (count of targetTerms) is greater than 0 then
  try
    tell application "Terminal"
      -- Pass 1: window-level match. Merged-window tabs are separate windows whose
      -- name carries the session title; "selected" is a no-op on windows, so the
      -- window must be raised via "frontmost".
      repeat with windowRef in windows
        set windowText to ""
        try
          set windowText to windowText & (name of windowRef as text)
        end try
        try
          set windowText to windowText & " " & (custom title of windowRef as text)
        end try
        try
          set windowText to windowText & " " & (tty of windowRef as text)
        end try
        if my textMatchesAny(windowText, targetTerms) then
          set frontmost of windowRef to true
          my raiseAppWindowOnly("com.apple.Terminal")
          return "Terminal"
        end if
      end repeat
      -- Pass 2: native (cmd-T) tabs. Background tab titles are invisible at the
      -- window level, so match per tab and select it before raising the window.
      repeat with windowRef in windows
        repeat with tabRef in tabs of windowRef
          set tabText to ""
          try
            set tabText to tabText & (custom title of tabRef as text)
          end try
          try
            set tabText to tabText & " " & (tty of tabRef as text)
          end try
          if my textMatchesAny(tabText, targetTerms) then
            set selected of tabRef to true
            set frontmost of windowRef to true
            my raiseAppWindowOnly("com.apple.Terminal")
            return "Terminal"
          end if
        end repeat
      end repeat
      repeat with windowRef in windows
        set windowText to ""
        try
          set windowText to windowText & (name of windowRef as text)
        end try
        try
          set windowText to windowText & " " & (custom title of windowRef as text)
        end try
        if my textMatchesAny(windowText, fallbackTerms) then
          set frontmost of windowRef to true
          my raiseAppWindowOnly("com.apple.Terminal")
          return "Terminal"
        end if
      end repeat
    end tell
  end try
end if

tell application "System Events"
  repeat with processName in {${processNames}}
    set processNameText to processName as text
    if exists application process processNameText then
      tell application process processNameText
        repeat with windowRef in windows
          set windowText to ""
          try
            set windowText to windowText & (name of windowRef as text)
          end try
          try
            set windowText to windowText & " " & (value of attribute "AXTitle" of windowRef as text)
          end try
          if my textMatchesAny(windowText, targetTerms) then
            try
              perform action "AXRaise" of windowRef
            end try
            set processBundleId to ""
            try
              set processBundleId to bundle identifier as text
            end try
            if processBundleId is "" or not (my raiseAppWindowOnly(processBundleId)) then set frontmost to true
            return processNameText
          end if
          ignoring case
            if windowText contains "claude" then
              try
                perform action "AXRaise" of windowRef
              end try
              set processBundleId to ""
              try
                set processBundleId to bundle identifier as text
              end try
              if processBundleId is "" or not (my raiseAppWindowOnly(processBundleId)) then set frontmost to true
              return processNameText
            end if
          end ignoring
        end repeat
      end tell
    end if
  end repeat
end tell
return ""
`;
}

function raiseClaudeCodeTerminalWindow(sessionTitles: string[]): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return new Promise((resolveRaised) => {
    execFile("/usr/bin/osascript", ["-e", claudeCodeTerminalRaiseScript(sessionTitles)], { timeout: 2500 }, (error, stdout) => {
      resolveRaised(!error && stdout.trim().length > 0);
    });
  });
}

async function openInstalledClaudeCodeTerminal(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  for (const bundleId of CLAUDE_CODE_TERMINAL_BUNDLES) {
    try {
      await openMacBundle(bundleId);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function openDesktopDeepLink(
  url: string,
  target: { bundleId: string; label: string }
): Promise<void> {
  if (process.platform !== "darwin") {
    await shell.openExternal(url);
    return;
  }

  try {
    await openMacBundle(target.bundleId);
    await delay(350);
    await openMacBundle(target.bundleId, url);
    await delay(350);
    await openMacBundle(target.bundleId);
    return;
  } catch (error) {
    console.error(`Failed to activate ${target.label} before deep link:`, error);
  }

  await shell.openExternal(url);
}

async function openCodexSession(sessionId: string): Promise<void> {
  const threadId = sessionId.trim();
  if (!CODEX_THREAD_ID_PATTERN.test(threadId)) return;
  await openDesktopDeepLink(`codex://threads/${threadId}`, {
    bundleId: CODEX_DESKTOP_BUNDLE_ID,
    label: "Codex"
  });
}

async function openClaudeCodeSession(sessionId: string, sessionTitle?: string): Promise<void> {
  const cliSessionId = sessionId.trim();
  if (!CODEX_THREAD_ID_PATTERN.test(cliSessionId)) return;
  const titleCandidates = claudeCodeOpenTitleCandidates(cliSessionId, sessionTitle);
  if (await raiseClaudeCodeTerminalWindow(titleCandidates)) return;
  if (await openInstalledClaudeCodeTerminal()) return;
  console.error("No Claude Code terminal window or terminal app found for session:", cliSessionId);
}

async function openClaudeDesktopSession(sessionId: string): Promise<void> {
  const desktopSessionId = sessionId.trim();
  if (!CODEX_THREAD_ID_PATTERN.test(desktopSessionId)) return;
  await openDesktopDeepLink(`claude://resume?session=${desktopSessionId}`, {
    bundleId: CLAUDE_DESKTOP_BUNDLE_ID,
    label: "Claude Desktop"
  });
}

async function openCursorSession(): Promise<void> {
  if (process.platform === "darwin") {
    await openMacAppByName("Cursor");
    await delay(350);
  }
  await shell.openExternal("cursor://");
}

async function openAgentSession(sessionId: string, provider?: AgentActivityProvider, sessionTitle?: string): Promise<void> {
  try {
    if (provider === "claude-code") {
      await openClaudeCodeSession(sessionId, sessionTitle);
      return;
    }
    if (provider === "claude-desktop") {
      await openClaudeDesktopSession(sessionId);
      return;
    }
    if (provider === "codex") {
      await openCodexSession(sessionId);
      return;
    }
    if (provider === "cursor") {
      await openCursorSession();
      return;
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
  resetExpiredBreakMute();
  if (!fromDemo && (blockingMode === "focusWarning" || blockingMode === "breakRun" || blockingMode === "hydration")) {
    scheduleBreakBusyRetry();
    return;
  }
  if (!fromDemo && focusActive) {
    scheduleBreakBusyRetry();
    return;
  }
  if (!fromDemo && breakMutedToday) {
    return;
  }
  ensurePetWindowVisible();
  blockingMode = "break";
  breakDueAt = null;
  publishSnapshot();
  if (!fromDemo) {
    updateStats((stats) => ({ ...stats, breakPromptsShown: stats.breakPromptsShown + 1 }));
  }
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
    if (!fromDemo && getSettings().hydrationReminderEnabled) scheduleHydrationBusyRetry();
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
  publishSnapshot();
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
  publishSnapshot();
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
  publishSnapshot();
  setPetState("focusDone");
  showBubble({
    id: "focus-complete",
    message: completed ? pick(text().bubble.focusComplete) : pick(text().bubble.focusCancelled),
    autoDismissMs: 2800
  });
  setTimeout(() => {
    if (!focusActive && !blockingMode) {
      if (showOverdueReminder()) return;
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
  if (zoomMeetingJoinActions.has(actionId)) {
    const joinUrl = zoomMeetingJoinActions.get(actionId);
    zoomMeetingJoinActions.delete(actionId);
    hideBubble();
    if (joinUrl) void shell.openExternal(joinUrl);
    return;
  }
  if (actionId === "zoom-meeting:dismiss") {
    hideBubble();
    return;
  }
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
    scheduleBreakReminderTimer(10 * 60 * 1000);
    return;
  }
  if (actionId === "break:mute") {
    breakMutedToday = true;
    breakMutedDate = todayKey();
    scheduleBreakMuteReset();
    if (breakTimer) clearTimeout(breakTimer);
    breakTimer = null;
    breakDueAt = null;
    blockingMode = null;
    publishSnapshot();
    setPetState("sad");
    showBubble({ id: "break-muted", message: pick(text().bubble.breakIgnore), autoDismissMs: 2600 });
    setTimeout(resumeLongTermState, 2700);
    return;
  }
  if (actionId === "hydration:done") {
    updateStats((stats) => ({ ...stats, watersLogged: stats.watersLogged + 1 }));
    blockingMode = null;
    publishSnapshot();
    setPetState("drinking");
    hideBubble();
    setTimeout(() => {
      if (blockingMode) return;
      setPetState("hydrationDone");
      showBubble({ id: "hydration-complete", message: pick(text().bubble.hydrationDone), autoDismissMs: 1800 });
      setTimeout(() => {
        scheduleHydrationReminderTimer();
        if (showOverdueReminder()) return;
        hideBubble();
        setPetState(focusActive ? "focusGuard" : "idle");
      }, 1900);
    }, 2400);
    return;
  }
  if (actionId === "hydration:snooze") {
    resumeLongTermState();
    scheduleHydrationReminderTimer(15 * 60 * 1000);
    return;
  }
  if (actionId === "focus:back") {
    blockingMode = null;
    publishSnapshot();
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
  ipcMain.handle("app:get-snapshot", (event) => snapshot(petSlotForWebContents(event.sender)));
  ipcMain.handle("app:check-for-updates", () => checkForUpdates({ notifyAvailable: true }));
  ipcMain.handle("custom-pet:select-asset", (_event, state: PetState) =>
    selectCustomPetAsset(state)
  );
  ipcMain.handle("custom-pet:import-asset", (_event, state: PetState, sourcePath: string) =>
    importCustomPetAsset(state, sourcePath)
  );
  ipcMain.handle("custom-pet:create-generation-job", (_event, input: CreateCustomPetGenerationInput) =>
    createCustomPetGenerationJob(input)
  );
  ipcMain.handle("custom-pet:complete-generation-job", (_event, input: CompleteCustomPetGenerationInput) =>
    completeCustomPetGenerationJob(input)
  );
  ipcMain.on("app:open-release-notes", openReleaseNotes);
  ipcMain.on("pet:clicked", (event) => {
    if (petSlotForWebContents(event.sender) !== "primary") return;
    if (blockingMode) return;
    happyFeedback(null);
  });
  ipcMain.on("pet:context-menu", (event) => showPetContextMenu(petSlotForWebContents(event.sender)));
  ipcMain.on("pet:drag-start", (event, offset: { offsetX: number; offsetY: number }) =>
    startPetDrag(petSlotForWebContents(event.sender), offset)
  );
  ipcMain.on("pet:drag-stop", (event) => stopPetDrag(petSlotForWebContents(event.sender)));
  ipcMain.on("pet:resize-start", (event) => startPetResize(petSlotForWebContents(event.sender)));
  ipcMain.on("pet:resize-stop", stopPetResize);
  ipcMain.on("agent:open-session", (_event, sessionId: string, provider?: AgentActivityProvider, title?: string) =>
    openAgentSession(sessionId, provider, title)
  );
  ipcMain.on("codex:open-session", (_event, sessionId: string) => openAgentSession(sessionId, "codex"));
  ipcMain.on("app:open-settings", createSettingsWindow);
  ipcMain.on("app:quit", runQuitAnimation);
  ipcMain.on("pet:hide", hidePetWindowFromMenu);
  ipcMain.on("pet:set-mouse-interactive", (_event, interactive: boolean) => {
    setPetMouseInteractive(petSlotForWebContents(_event.sender), interactive);
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

app.whenReady().then(async () => {
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
    const customPetsRoot = resolve(app.getPath("userData"), "custom_pets");
    const assetPath = relativePath.startsWith("custom_pet_assets/") || relativePath.startsWith("custom_pets/")
      ? resolve(app.getPath("userData"), relativePath)
      : resolve(appBase, relativePath);
    const isInsideBuiltInAssetRoot =
      assetPath === builtInAssetRoot || assetPath.startsWith(`${builtInAssetRoot}${sep}`);
    const isInsideCustomAssetRoot =
      assetPath === customAssetRoot || assetPath.startsWith(`${customAssetRoot}${sep}`);
    const isInsideCustomPetsRoot =
      assetPath === customPetsRoot || assetPath.startsWith(`${customPetsRoot}${sep}`);

    if (!isInsideBuiltInAssetRoot && !isInsideCustomAssetRoot && !isInsideCustomPetsRoot) {
      return new Response("Asset not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(assetPath).href);
  });

  customPetStore = createCustomPetStore(app.getPath("userData"));
  customPetLibrary = await customPetStore.loadIndex();
  getStats();
  registerIpc();
  createPetWindow();
  syncPetWindowsForSettings();
  createTray();
  registerDisplayChangeHandlers();
  registerPowerMonitorHandlers();
  scheduleCodexActivityPolling();
  scheduleReminderTimers();
  scheduleDistractionDetection();
  scheduleZoomShareAutoHide();
  scheduleZoomMeetingReminders();
  if (IS_DEV) {
    createSettingsWindow();
  }
  if (getSettings().checkUpdatesOnLaunchEnabled) {
    setTimeout(() => void checkForUpdates({ notifyAvailable: true }), 1500);
  }

  app.on("activate", () => {
    if (!petWindow) createPetWindow();
    syncPetWindowsForSettings();
    updateTrayMenu();
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
