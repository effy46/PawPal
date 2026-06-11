import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createCustomPetJob,
  getCustomPetJobActions,
  reconcileCustomPetJob
} from "../src/main/customPetJobs";
import { PET_STATE_ORDER } from "../src/shared/petAppearances";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pawpal-custom-pet-job-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const tests = [
  {
    name: "createCustomPetJob writes prompt and atomic job files",
    async run(): Promise<void> {
      await withTempDir(async (dir) => {
        const customPetsRoot = join(dir, "custom_pets");
        const job = await createCustomPetJob({
          customPetsRoot,
          petId: "fiona-dog",
          displayName: " Fiona Dog ",
          prompt: "Draw a tiny white dog.",
          cwd: "/Users/ffeng/Documents/Personal/PawPal"
        });

        const petDir = join(customPetsRoot, "fiona-dog");
        assert.equal(job.petId, "fiona-dog");
        assert.equal(job.displayName, "Fiona Dog");
        assert.equal(job.status, "needs_input");
        assert.equal(job.threadId, null);
        assert.equal(job.promptPath, join(petDir, "prompt.md"));
        assert.equal(existsSync(join(petDir, "job.json")), true);
        assert.equal(await readFile(join(petDir, "prompt.md"), "utf8"), "Draw a tiny white dog.\n");
        assert.deepEqual(JSON.parse(await readFile(join(petDir, "job.json"), "utf8")), job);
      });
    }
  },
  {
    name: "custom pet jobs include all 15 required pet states",
    async run(): Promise<void> {
      await withTempDir(async (dir) => {
        const job = await createCustomPetJob({
          customPetsRoot: join(dir, "custom_pets"),
          petId: "all-states",
          displayName: "All States",
          prompt: "Make every animation."
        });

        assert.equal(PET_STATE_ORDER.length, 15);
        assert.deepEqual(
          job.states.map((state) => state.state),
          PET_STATE_ORDER
        );
        assert.equal(job.summary.totalStates, 15);
        assert.equal(job.summary.queuedStates, 15);
      });
    }
  },
  {
    name: "CLI fallback includes prompt path and cwd",
    async run(): Promise<void> {
      await withTempDir(async (dir) => {
        const cwd = "/Users/ffeng/Documents/Personal/PawPal";
        const job = await createCustomPetJob({
          customPetsRoot: join(dir, "custom_pets"),
          petId: "fallback",
          displayName: "Fallback",
          prompt: "Make pet.",
          cwd
        });

        assert.equal(job.actions.copyCliFallbackText.includes(job.promptPath), true);
        assert.equal(job.actions.copyCliFallbackText.includes(cwd), true);
        assert.equal(job.actions.openCodexInstructions.includes(job.promptPath), true);
      });
    }
  },
  {
    name: "resume is available only with valid threadId",
    async run(): Promise<void> {
      const validThreadId = "019e8ad0-997d-70d1-8479-f1380e3a4b56";

      assert.equal(getCustomPetJobActions({ threadId: null }).canResume, false);
      assert.equal(getCustomPetJobActions({ threadId: "not-a-uuid" }).canResume, false);
      assert.equal(getCustomPetJobActions({ threadId: validThreadId }).canResume, true);
    }
  },
  {
    name: "reconcileCustomPetJob scans source GIFs and increments progress",
    async run(): Promise<void> {
      await withTempDir(async (dir) => {
        const customPetsRoot = join(dir, "custom_pets");
        const job = await createCustomPetJob({
          customPetsRoot,
          petId: "scan",
          displayName: "Scan",
          prompt: "Make pet."
        });

        await writeFile(join(customPetsRoot, "scan", "source", "idle.gif"), "gif");
        await writeFile(join(customPetsRoot, "scan", "source", "focusAlert.gif"), "gif");

        const reconciled = await reconcileCustomPetJob(job.jobPath);

        assert.equal(reconciled.summary.completeStates, 2);
        assert.equal(reconciled.states.find((state) => state.state === "idle")?.status, "complete");
        assert.equal(reconciled.states.find((state) => state.state === "focusAlert")?.status, "complete");
        assert.equal(reconciled.status, "running");
      });
    }
  },
  {
    name: "reconcileCustomPetJob keeps needs_input with no source GIF evidence",
    async run(): Promise<void> {
      await withTempDir(async (dir) => {
        const job = await createCustomPetJob({
          customPetsRoot: join(dir, "custom_pets"),
          petId: "empty-scan",
          displayName: "Empty Scan",
          prompt: "Make pet."
        });

        const reconciled = await reconcileCustomPetJob(job.jobPath);

        assert.equal(reconciled.summary.completeStates, 0);
        assert.equal(reconciled.status, "needs_input");
      });
    }
  },
  {
    name: "createCustomPetJob rejects path traversal pet id",
    async run(): Promise<void> {
      await withTempDir(async (dir) => {
        await assert.rejects(
          () =>
            createCustomPetJob({
              customPetsRoot: join(dir, "custom_pets"),
              petId: "../bad",
              displayName: "Bad",
              prompt: "No."
            }),
          /Invalid pet id/
        );
      });
    }
  }
];
