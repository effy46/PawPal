import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  getCustomPetAssetDefinition,
  getPetAssetDefinition,
  hasRequiredCustomPetAssets,
  REQUIRED_CUSTOM_PET_STATES,
  PET_STATE_ORDER,
  petAppearanceOptions,
  resolvePetAppearanceId
} from "../src/shared/petAppearances";
import type { CustomPetLibrary, CustomPetManifest, PetAppearanceId, PetState } from "../src/shared/types";

const petStates: PetState[] = PET_STATE_ORDER;

function completeManifest(id = "buddy", status: CustomPetManifest["status"] = "complete"): CustomPetManifest {
  const generationId = "gen-1";
  return {
    id,
    name: "Buddy",
    status,
    generationId,
    createdAt: 1,
    updatedAt: 2,
    assets: Object.fromEntries(
      PET_STATE_ORDER.map((state) => [
        state,
        {
          relativePath: `custom_pets/${id}/normalized/${generationId}/${state}.gif`,
          originalName: `${state}.gif`,
          updatedAt: 2
        }
      ])
    ) as CustomPetManifest["assets"]
  };
}

function libraryFor(...manifests: CustomPetManifest[]): CustomPetLibrary {
  return {
    updatedAt: 3,
    manifests: Object.fromEntries(manifests.map((manifest) => [manifest.id, manifest]))
  };
}

function pathsFor(appearanceId: PetAppearanceId, state: PetState): string[] {
  const asset = getPetAssetDefinition(appearanceId, state);
  return Array.isArray(asset.path) ? asset.path : [asset.path];
}

export const tests = [
  {
    name: "petAppearanceOptions includes Xiao Ji Mao and Hachi",
    run(): void {
      assert.equal(
        petAppearanceOptions("zh-CN").some((option) => option.value === "xiaoJiMao"),
        true
      );
      assert.equal(
        petAppearanceOptions("en").some((option) => option.value === "xiaoJiMao"),
        true
      );
      assert.equal(
        petAppearanceOptions("zh-CN").some((option) => option.value === "hachi"),
        true
      );
      assert.equal(
        petAppearanceOptions("en").some((option) => option.value === "hachi"),
        true
      );
    }
  },
  {
    name: "resolvePetAppearanceId accepts Xiao Ji Mao and Hachi",
    run(): void {
      assert.equal(resolvePetAppearanceId("xiaoJiMao"), "xiaoJiMao");
      assert.equal(resolvePetAppearanceId("hachi"), "hachi");
    }
  },
  {
    name: "custom pet required states match all pet states",
    run(): void {
      assert.deepEqual(REQUIRED_CUSTOM_PET_STATES, PET_STATE_ORDER);
    }
  },
  {
    name: "resolvePetAppearanceId accepts namespaced custom pet ids and preserves legacy custom input",
    run(): void {
      assert.equal(resolvePetAppearanceId("custom:buddy"), "custom:buddy");
      assert.equal(resolvePetAppearanceId("custom"), "custom");
    }
  },
  {
    name: "complete custom pet resolves canonical state asset path",
    run(): void {
      const library = libraryFor(completeManifest("buddy"));

      assert.deepEqual(getPetAssetDefinition("custom:buddy", "focusAlert", library), {
        path: "custom_pets/buddy/normalized/gen-1/focusAlert.gif"
      });
    }
  },
  {
    name: "draft and incomplete custom pets are not selectable",
    run(): void {
      const draft = completeManifest("drafty", "draft");
      const incomplete = completeManifest("partial");
      delete incomplete.assets.focusAlert;

      assert.equal(getCustomPetAssetDefinition(libraryFor(draft), "custom:drafty", "idle"), null);
      assert.equal(getCustomPetAssetDefinition(libraryFor(incomplete), "custom:partial", "idle"), null);
    }
  },
  {
    name: "legacy inline custom pet assets require all pet states",
    run(): void {
      const legacy = completeManifest("legacy");

      assert.equal(hasRequiredCustomPetAssets(legacy), true);
      assert.deepEqual(getCustomPetAssetDefinition(legacy, "custom:legacy", "focusAlert"), {
        path: "custom_pets/legacy/normalized/gen-1/focusAlert.gif"
      });
    }
  },
  {
    name: "Xiao Ji Mao and Hachi asset paths exist for all pet states",
    run(): void {
      for (const state of petStates) {
        for (const path of pathsFor("xiaoJiMao", state)) {
          assert.equal(existsSync(resolve(process.cwd(), path)), true, path);
        }
        for (const path of pathsFor("hachi", state)) {
          assert.equal(existsSync(resolve(process.cwd(), path)), true, path);
        }
      }
    }
  },
  {
    name: "quit animation uses per-appearance asset for Line Dog, Xiao Ji Mao, and Hachi",
    run(): void {
      assert.deepEqual(pathsFor("lovartPuppy", "quitRunning"), [
        "pet_assets/线条小狗/quitRunning/running_dog_left.gif"
      ]);
      assert.deepEqual(pathsFor("xiaoJiMao", "quitRunning"), [
        "pet_assets/线条小狗/quitRunning/running_dog_left.gif"
      ]);
      assert.deepEqual(pathsFor("hachi", "quitRunning"), [
        "pet_assets/Hachi/breakRunning/break-running.gif"
      ]);
      assert.deepEqual(pathsFor("lineDog", "quitRunning"), [
        "pet_assets/线条小狗/quitRunning/running_dog_right.gif"
      ]);
    }
  }
];
