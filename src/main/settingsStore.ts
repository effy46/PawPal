import { DEFAULT_SETTINGS } from "../shared/constants";
import { resolveLanguage } from "../shared/i18n";
import {
  hasRequiredCustomPetAssets,
  normalizeCustomPetAppearance,
  resolvePetAppearanceId
} from "../shared/petAppearances";
import type { CustomPetAppearance, Settings } from "../shared/types";
import type { AgentActivitySource, PetAppearanceId } from "../shared/types";

export type SettingsStore = {
  get(key: "settings"): Settings;
};

function normalizeNumber(value: unknown, fallback: number, min: number, max = Number.POSITIVE_INFINITY): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isAgentActivitySource(value: unknown): value is AgentActivitySource {
  return value === "codex" || value === "claude" || value === "cursor" || value === "none";
}

function defaultAgentSourceForAppearance(appearanceId: PetAppearanceId): AgentActivitySource {
  if (appearanceId === "lineDog") return "codex";
  if (appearanceId === "xiaoJiMao") return "claude";
  return "none";
}

function isHachiCustomPetAppearance(custom: CustomPetAppearance | null): boolean {
  const idle = custom?.assets.idle;
  return Boolean(
    idle &&
      (idle.originalName === "pinterest-25df3773b3f599886bf60b940d2d4c43.gif" ||
        idle.relativePath.includes("pinterest-25df3773b3f599886bf60b940d2d4c43.gif"))
  );
}

function migrateKnownCustomAppearance(
  appearanceId: PetAppearanceId,
  customPetAppearance: CustomPetAppearance | null
): PetAppearanceId {
  return appearanceId === "custom" && isHachiCustomPetAppearance(customPetAppearance) ? "hachi" : appearanceId;
}

function normalizeAgentSources(
  primaryAgentSource: AgentActivitySource,
  secondaryAgentSource: AgentActivitySource,
  dualAgentModeEnabled: boolean
): { primaryAgentSource: AgentActivitySource; secondaryAgentSource: AgentActivitySource } {
  if (!dualAgentModeEnabled || primaryAgentSource === "none" || primaryAgentSource !== secondaryAgentSource) {
    return { primaryAgentSource, secondaryAgentSource };
  }
  return {
    primaryAgentSource,
    secondaryAgentSource: primaryAgentSource === "codex" ? "claude" : "codex"
  };
}

export function normalizeSettings(stored: Partial<Settings> = {}): Settings {
  const customPetAppearance = normalizeCustomPetAppearance(stored.customPetAppearance);
  const petAppearanceId = migrateKnownCustomAppearance(
    resolvePetAppearanceId(stored.petAppearanceId ?? DEFAULT_SETTINGS.petAppearanceId),
    customPetAppearance
  );
  const normalizedPetAppearanceId =
    petAppearanceId === "custom" && !hasRequiredCustomPetAssets(customPetAppearance)
      ? DEFAULT_SETTINGS.petAppearanceId
      : petAppearanceId;
  const secondaryPetAppearanceId = migrateKnownCustomAppearance(
    resolvePetAppearanceId(stored.secondaryPetAppearanceId ?? DEFAULT_SETTINGS.secondaryPetAppearanceId),
    customPetAppearance
  );
  const normalizedSecondaryPetAppearanceId =
    secondaryPetAppearanceId === "custom" && !hasRequiredCustomPetAssets(customPetAppearance)
      ? DEFAULT_SETTINGS.secondaryPetAppearanceId
      : secondaryPetAppearanceId;
  const dualAgentModeEnabled = stored.dualAgentModeEnabled === true;
  const normalizedSources = normalizeAgentSources(
    isAgentActivitySource(stored.primaryAgentSource)
      ? stored.primaryAgentSource
      : defaultAgentSourceForAppearance(normalizedPetAppearanceId),
    isAgentActivitySource(stored.secondaryAgentSource)
      ? stored.secondaryAgentSource
      : defaultAgentSourceForAppearance(normalizedSecondaryPetAppearanceId),
    dualAgentModeEnabled
  );

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    language: resolveLanguage(stored.language ?? DEFAULT_SETTINGS.language),
    petAppearanceId: normalizedPetAppearanceId,
    customPetAppearance,
    ...normalizedSources,
    dualAgentModeEnabled,
    secondaryPetAppearanceId: normalizedSecondaryPetAppearanceId,
    zoomMeetingIcsUrl:
      typeof stored.zoomMeetingIcsUrl === "string"
        ? stored.zoomMeetingIcsUrl.trim()
        : DEFAULT_SETTINGS.zoomMeetingIcsUrl,
    zoomMeetingReminderLeadMinutes: normalizeNumber(
      stored.zoomMeetingReminderLeadMinutes,
      DEFAULT_SETTINGS.zoomMeetingReminderLeadMinutes,
      0,
      30
    ),
    dailyWaterGoal: normalizeNumber(
      stored.dailyWaterGoal,
      DEFAULT_SETTINGS.dailyWaterGoal,
      1,
      12
    ),
    breakRunDurationSeconds: normalizeNumber(
      stored.breakRunDurationSeconds,
      DEFAULT_SETTINGS.breakRunDurationSeconds,
      10
    ),
    agentActivityRetentionMinutes: normalizeNumber(
      stored.agentActivityRetentionMinutes,
      DEFAULT_SETTINGS.agentActivityRetentionMinutes,
      1,
      60
    )
  };
}

export function getStoredSettings(store: SettingsStore): Settings {
  return normalizeSettings(store.get("settings"));
}
