import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCustomPetStore } from "../src/main/customPetStore";
import { PET_STATE_ORDER } from "../src/shared/petAppearances";
import type { CustomPetJobSummary, CustomPetManifest } from "../src/shared/types";

function completeManifest(id = "buddy"): CustomPetManifest {
  const generationId = "gen-1";
  return {
    id,
    name: "Buddy",
    status: "complete",
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

async function tempUserData(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pawpal-custom-pets-"));
}

export const tests = [
  {
    name: "customPetStore indexes Slice C job statuses without generation id",
    async run(): Promise<void> {
      const userDataDir = await tempUserData();
      const store = createCustomPetStore(userDataDir);
      await store.saveManifest(completeManifest("buddy"));
      const job: CustomPetJobSummary = {
        petId: "buddy",
        status: "queued",
        updatedAt: 3,
        states: {
          idle: { state: "idle", status: "running" },
          sitting: { state: "sitting", status: "needs_input" }
        }
      };

      await store.saveJobSummary("buddy", job);
      const index = await store.rebuildIndex();

      assert.equal(index.jobs!.buddy?.generationId, undefined);
      assert.equal(index.jobs!.buddy?.status, "queued");
      assert.equal(index.jobs!.buddy?.states?.idle?.status, "running");
      assert.equal(index.jobs!.buddy?.states?.sitting?.status, "needs_input");
    }
  },
  {
    name: "customPetStore indexes draft job without manifest",
    async run(): Promise<void> {
      const userDataDir = await tempUserData();
      const store = createCustomPetStore(userDataDir);
      await mkdir(join(userDataDir, "custom_pets", "draft-buddy"), { recursive: true });
      await writeFile(
        join(userDataDir, "custom_pets", "draft-buddy", "job.json"),
        JSON.stringify({
          id: "job-1",
          petId: "draft-buddy",
          status: "queued",
          createdAt: 10,
          updatedAt: 11,
          states: [
            { state: "idle", status: "queued", sourcePath: null, updatedAt: null, error: null }
          ]
        }),
        "utf8"
      );

      const index = await store.rebuildIndex();

      assert.equal(index.manifests["draft-buddy"], undefined);
      assert.equal(index.jobs!["draft-buddy"]?.generationId, "job-1");
      assert.equal(index.jobs!["draft-buddy"]?.status, "queued");
      assert.equal(index.jobs!["draft-buddy"]?.states?.idle?.status, "queued");
    }
  },
  {
    name: "customPetStore rebuilds index from pet folders",
    async run(): Promise<void> {
      const userDataDir = await tempUserData();
      const store = createCustomPetStore(userDataDir);
      await mkdir(join(userDataDir, "custom_pets", "buddy"), { recursive: true });
      await writeFile(
        join(userDataDir, "custom_pets", "buddy", "pet.json"),
        JSON.stringify(completeManifest("buddy")),
        "utf8"
      );
      await writeFile(
        join(userDataDir, "custom_pets", "buddy", "job.json"),
        JSON.stringify({ petId: "buddy", generationId: "gen-1", status: "complete", updatedAt: 2 }),
        "utf8"
      );

      const index = await store.rebuildIndex();

      assert.equal(index.manifests.buddy.name, "Buddy");
      assert.equal(index.jobs!.buddy?.generationId, "gen-1");
      assert.equal(JSON.parse(await readFile(join(userDataDir, "custom_pets", "index.json"), "utf8")).manifests.buddy.id, "buddy");
    }
  },
  {
    name: "customPetStore soft deletes pet folder to trash",
    async run(): Promise<void> {
      const userDataDir = await tempUserData();
      const store = createCustomPetStore(userDataDir);
      await store.saveManifest(completeManifest("buddy"));

      const deletedPath = await store.softDeletePet("buddy");

      assert.equal(deletedPath.startsWith(join(userDataDir, "custom_pets", ".trash", "buddy-")), true);
      assert.equal((await stat(join(deletedPath, "pet.json"))).isFile(), true);
      assert.equal((await store.rebuildIndex()).manifests.buddy, undefined);
    }
  },
  {
    name: "customPetStore rejects traversal pet ids",
    async run(): Promise<void> {
      const store = createCustomPetStore(await tempUserData());

      await assert.rejects(() => store.saveManifest({ ...completeManifest("bad"), id: "../bad" }), /Invalid pet id/);
      await assert.rejects(() => store.softDeletePet("bad/../id"), /Invalid pet id/);
    }
  }
];
