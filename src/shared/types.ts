export type Language = "zh-CN" | "en";

export type BuiltInPetAppearanceId = "lovartPuppy" | "lineDog" | "xiaoJiMao" | "hachi";

export type CustomPetAppearanceId = `custom:${string}`;
export type LegacyCustomPetAppearanceId = "custom";
export type PetAppearanceId = BuiltInPetAppearanceId | CustomPetAppearanceId | LegacyCustomPetAppearanceId;

export type PetFacing = "left" | "right";

export type CodexActivityState = "idle" | "working" | "reviewing" | "complete" | "waiting" | "error";
export type AgentActivityProvider = "codex" | "claude-code" | "claude-desktop" | "cursor";
export type AgentActivitySource = AgentActivityProvider | "none";
export type PetSlotId = "primary" | "secondary";

export type CodexActivitySession = {
  id: string;
  title: string;
  state: CodexActivityState;
  message: string | null;
  updatedAt: number;
  path: string;
};

export type CodexActivity = {
  state: CodexActivityState;
  message: string | null;
  updatedAt: number | null;
  path: string;
  provider: AgentActivityProvider;
  source: "manual" | "codex-session" | "claude-code-session" | "claude-desktop-session" | "cursor-session";
  sessions: CodexActivitySession[];
};

export type PetState =
  | "idle"
  | "sitting"
  | "happy"
  | "breakPrompt"
  | "breakRunning"
  | "breakDone"
  | "hydrationPrompt"
  | "drinking"
  | "hydrationDone"
  | "focusGuard"
  | "focusAlert"
  | "focusDone"
  | "sad"
  | "sleeping"
  | "quitRunning";

export type CustomPetAsset = {
  relativePath: string;
  originalName: string;
  updatedAt: number;
};

export type CustomPetAppearance = {
  name: string;
  assets: Partial<Record<PetState, CustomPetAsset>>;
};

export type CustomPetStatus = "complete" | "draft" | "error";
export type CustomPetGenerationStatus = "queued" | "running" | "needs_input" | "complete" | "error";
export type CustomPetGenerationStateStatus = CustomPetGenerationStatus;

export type CustomPetManifest = {
  id: string;
  name: string;
  status: CustomPetStatus;
  generationId: string;
  createdAt: number;
  updatedAt: number;
  assets: Partial<Record<PetState, CustomPetAsset>>;
  error?: string | null;
};

export type CustomPetJobStateSummary = {
  state: PetState;
  status: CustomPetGenerationStateStatus;
  sourceRelativePath?: string;
  normalizedRelativePath?: string;
  error?: string | null;
};

export type CustomPetJobSummary = {
  petId: string;
  generationId?: string;
  status: CustomPetGenerationStatus;
  createdAt?: number;
  updatedAt: number;
  states?: Partial<Record<PetState, CustomPetJobStateSummary>>;
  error?: string | null;
};

export type CreateCustomPetGenerationInput = {
  displayName: string;
  prompt: string;
};

export type CustomPetGenerationActions = {
  canResume: boolean;
  threadId: string | null;
  promptPath: string;
  cwd: string;
  openCodexInstructions: string;
  copyCliFallbackText: string;
};

export type CreatedCustomPetGenerationJob = {
  petId: string;
  displayName: string;
  status: CustomPetGenerationStatus;
  createdAt: number;
  updatedAt: number;
  promptPath: string;
  promptText: string;
  sourceDir: string;
  actions: CustomPetGenerationActions;
};

export type CompleteCustomPetGenerationInput = {
  petId: string;
};

export type CompleteCustomPetGenerationResult = {
  manifest: CustomPetManifest | null;
  job: CustomPetJobSummary | null;
  errors: string[];
};

export type CustomPetLibrary = {
  updatedAt: number;
  manifests: Record<string, CustomPetManifest>;
  jobs?: Record<string, CustomPetJobSummary>;
};

export type BubbleAction = {
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "danger";
};

export type SpeechBubble = {
  id: string;
  message: string;
  actions?: BubbleAction[];
  autoDismissMs?: number;
};

export type BlockingMode = "break" | "breakRun" | "hydration" | "focusWarning" | null;

export type Settings = {
  language: Language;
  petAppearanceId: PetAppearanceId;
  customPetAppearance: CustomPetAppearance | null;
  primaryAgentSource: AgentActivitySource;
  dualAgentModeEnabled: boolean;
  secondaryPetAppearanceId: PetAppearanceId;
  secondaryAgentSource: AgentActivitySource;
  onboardingDismissed: boolean;
  launchAtLoginEnabled: boolean;
  checkUpdatesOnLaunchEnabled: boolean;
  zoomShareAutoHideEnabled: boolean;
  zoomMeetingReminderEnabled: boolean;
  zoomMeetingIcsUrl: string;
  zoomMeetingReminderLeadMinutes: number;
  agentActivityRetentionMinutes: number;
  breakReminderEnabled: boolean;
  breakIntervalMinutes: number;
  breakRunDurationSeconds: number;
  hydrationReminderEnabled: boolean;
  hydrationIntervalMinutes: number;
  dailyWaterGoal: number;
  focusDurationMinutes: number;
  distractionDetectionEnabled: boolean;
  distractionGraceSeconds: number;
  distractionBlockedApps: string[];
  distractionBlockedKeywords: string[];
};

export type TodayStats = {
  date: string;
  breaksTaken: number;
  breakPromptsShown: number;
  watersLogged: number;
  focusMinutes: number;
  focusWarnings: number;
};

export type StatsHistory = Record<string, TodayStats>;

export type TimerStatus = {
  breakDueAt: number | null;
  hydrationDueAt: number | null;
  focusEndsAt: number | null;
};

export type DistractionStatus = {
  state: "idle" | "watching" | "permission-needed" | "unsupported" | "error";
  activeApp: string;
  activeWindowTitle: string;
  matchedRule: string | null;
  lastCheckedAt: number | null;
  lastWarningAt: number | null;
  error: string | null;
};

export type AppSnapshot = {
  appInfo: AppInfo;
  updateCheck: UpdateCheckResult;
  settings: Settings;
  stats: TodayStats;
  statsHistory: StatsHistory;
  customPetLibrary: CustomPetLibrary;
  timers: TimerStatus;
  distraction: DistractionStatus;
  petState: PetState;
  petFacing: PetFacing;
  petScale: number;
  petSlotId: PetSlotId;
  codexActivity: CodexActivity;
  blockingMode: BlockingMode;
  focusActive: boolean;
  dogVisible: boolean;
};

export type AppInfo = {
  version: string;
  releaseNotesUrl: string;
};

export type UpdateCheckStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "error";

export type UpdateCheckResult = {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  checkedAt: number | null;
  error: string | null;
};

export type DemoTrigger =
  | "break"
  | "hydration"
  | "focusWarning"
  | "happy"
  | "codexIdle"
  | "codexWorking"
  | "codexReviewing"
  | "codexWaiting"
  | "codexError";

export type RendererEventMap = {
  "pet:set-state": PetState;
  "pet:show-bubble": SpeechBubble;
  "pet:hide-bubble": void;
  "settings:updated": Settings;
  "stats:updated": TodayStats;
  "app:snapshot": AppSnapshot;
};
