import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/shared/constants";
import { PET_STATE_ORDER } from "../src/shared/petAppearances";
import { normalizeSettings } from "../src/main/settingsStore";

export const tests = [
  {
    name: "normalizeSettings fills missing values from defaults",
    run(): void {
      assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
    }
  },
  {
    name: "normalizeSettings falls back from invalid language and pet appearance",
    run(): void {
      const settings = normalizeSettings({
        language: "fr" as never,
        petAppearanceId: "cat" as never
      });

      assert.equal(settings.language, DEFAULT_SETTINGS.language);
      assert.equal(settings.petAppearanceId, DEFAULT_SETTINGS.petAppearanceId);
    }
  },
  {
    name: "normalizeSettings preserves valid stored values",
    run(): void {
      const settings = normalizeSettings({
        language: "en",
        petAppearanceId: "lovartPuppy",
        primaryAgentSource: "cursor",
        launchAtLoginEnabled: true,
        checkUpdatesOnLaunchEnabled: true,
        agentActivityRetentionMinutes: 12,
        breakRunDurationSeconds: 90
      });

      assert.equal(settings.language, "en");
      assert.equal(settings.petAppearanceId, "lovartPuppy");
      assert.equal(settings.primaryAgentSource, "cursor");
      assert.equal(settings.launchAtLoginEnabled, true);
      assert.equal(settings.checkUpdatesOnLaunchEnabled, true);
      assert.equal(settings.agentActivityRetentionMinutes, 12);
      assert.equal(settings.breakRunDurationSeconds, 90);
    }
  },
  {
    name: "normalizeSettings defaults Apple Calendar source to disabled",
    run(): void {
      assert.equal(DEFAULT_SETTINGS.zoomMeetingAppleCalendarEnabled, false);
      assert.equal(normalizeSettings().zoomMeetingAppleCalendarEnabled, false);
      assert.equal(
        normalizeSettings({ zoomMeetingAppleCalendarEnabled: "yes" as never }).zoomMeetingAppleCalendarEnabled,
        false
      );
    }
  },
  {
    name: "normalizeSettings preserves enabled Apple Calendar source",
    run(): void {
      assert.equal(
        normalizeSettings({ zoomMeetingAppleCalendarEnabled: true }).zoomMeetingAppleCalendarEnabled,
        true
      );
    }
  },
  {
    name: "normalizeSettings clamps daily water goal",
    run(): void {
      assert.equal(normalizeSettings({ dailyWaterGoal: 0 }).dailyWaterGoal, 1);
      assert.equal(normalizeSettings({ dailyWaterGoal: 99 }).dailyWaterGoal, 12);
      assert.equal(
        normalizeSettings({ dailyWaterGoal: Number.NaN }).dailyWaterGoal,
        DEFAULT_SETTINGS.dailyWaterGoal
      );
    }
  },
  {
    name: "normalizeSettings clamps agent activity retention",
    run(): void {
      assert.equal(normalizeSettings({ agentActivityRetentionMinutes: 0 }).agentActivityRetentionMinutes, 1);
      assert.equal(normalizeSettings({ agentActivityRetentionMinutes: 120 }).agentActivityRetentionMinutes, 60);
      assert.equal(
        normalizeSettings({ agentActivityRetentionMinutes: Number.NaN }).agentActivityRetentionMinutes,
        DEFAULT_SETTINGS.agentActivityRetentionMinutes
      );
    }
  },
  {
    name: "normalizeSettings defaults agent source from pet appearance",
    run(): void {
      assert.equal(normalizeSettings({ petAppearanceId: "xiaoJiMao" }).primaryAgentSource, "claude-code");
      assert.equal(normalizeSettings({ petAppearanceId: "lovartPuppy" }).primaryAgentSource, "none");
    }
  },
  {
    name: "normalizeSettings migrates legacy Claude source to Claude Code",
    run(): void {
      assert.equal(normalizeSettings({ primaryAgentSource: "claude" as never }).primaryAgentSource, "claude-code");
    }
  },
  {
    name: "normalizeSettings keeps dual agent sources distinct",
    run(): void {
      const settings = normalizeSettings({
        dualAgentModeEnabled: true,
        primaryAgentSource: "cursor",
        secondaryAgentSource: "cursor"
      });

      assert.equal(settings.primaryAgentSource, "cursor");
      assert.equal(settings.secondaryAgentSource, "codex");
    }
  },
  {
    name: "normalizeSettings enforces break run duration minimum only",
    run(): void {
      assert.equal(normalizeSettings({ breakRunDurationSeconds: 5 }).breakRunDurationSeconds, 10);
      assert.equal(normalizeSettings({ breakRunDurationSeconds: 1200 }).breakRunDurationSeconds, 1200);
      assert.equal(
        normalizeSettings({ breakRunDurationSeconds: Number.NaN }).breakRunDurationSeconds,
        DEFAULT_SETTINGS.breakRunDurationSeconds
      );
    }
  },
  {
    name: "normalizeSettings preserves valid custom pet settings",
    run(): void {
      const settings = normalizeSettings({
        petAppearanceId: "custom",
        customPetAppearance: {
          name: "My Pet",
          assets: Object.fromEntries(
            PET_STATE_ORDER.map((state) => [
              state,
              {
                relativePath: `custom_pet_assets/${state}/my-pet.gif`,
                originalName: "my-pet.gif",
                updatedAt: 1
              }
            ])
          )
        }
      });

      assert.equal(settings.petAppearanceId, "custom");
      assert.equal(settings.customPetAppearance?.assets.idle?.relativePath, "custom_pet_assets/idle/my-pet.gif");
    }
  },
  {
    name: "normalizeSettings migrates known Hachi custom pet to built-in Hachi",
    run(): void {
      const settings = normalizeSettings({
        secondaryPetAppearanceId: "custom",
        customPetAppearance: {
          name: "Custom",
          assets: {
            idle: {
              relativePath: "custom_pet_assets/idle/idle-1778998869922-pinterest-25df3773b3f599886bf60b940d2d4c43.gif",
              originalName: "pinterest-25df3773b3f599886bf60b940d2d4c43.gif",
              updatedAt: 1
            }
          }
        }
      });

      assert.equal(settings.secondaryPetAppearanceId, "hachi");
    }
  },
  {
    name: "normalizeSettings falls back from custom pet when required assets are missing",
    run(): void {
      const settings = normalizeSettings({
        petAppearanceId: "custom",
        customPetAppearance: {
          name: "My Pet",
          assets: {
            happy: {
              relativePath: "custom_pet_assets/happy/my-pet.gif",
              originalName: "my-pet.gif",
              updatedAt: 1
            }
          }
        }
      });

      assert.equal(settings.petAppearanceId, DEFAULT_SETTINGS.petAppearanceId);
    }
  }
];
