import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { precheckRawGif, normalizeCustomPetBundle, postcheckRuntimeGif } from "../src/main/customPetGif";
import { PET_STATE_ORDER } from "../src/shared/petAppearances";
import type { PetState } from "../src/shared/types";

type FrameInput = {
  delayCs?: number;
  pixels: number[];
};

const require = createRequire(import.meta.url);
const { GIFEncoder } = require("gifenc") as {
  GIFEncoder: () => {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options: { palette: number[][]; delay: number; transparent: boolean; transparentIndex: number; repeat?: number }
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
};

function gifBytes(width: number, height: number, frames: FrameInput[], transparent = true): Uint8Array {
  const gif = GIFEncoder();
  const palette = [
    [0, 0, 0, 0],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 255, 255]
  ];

  frames.forEach((frame, index) => {
    gif.writeFrame(Uint8Array.from(frame.pixels), width, height, {
      palette,
      delay: (frame.delayCs ?? 8) * 10,
      transparent,
      transparentIndex: 0,
      repeat: index === 0 ? 0 : undefined
    });
  });
  gif.finish();
  return gif.bytes();
}

function transparentSprite(width: number, height: number, colorIndex: number, offset = 0): number[] {
  const pixels = new Array(width * height).fill(0);
  for (let y = 1; y < Math.min(height - 1, 5); y += 1) {
    for (let x = 1 + offset; x < Math.min(width - 1, 5 + offset); x += 1) {
      pixels[y * width + x] = colorIndex;
    }
  }
  return pixels;
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pawpal-custom-gif-"));
}

async function writeGif(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, bytes);
}

async function writeSourceBundle(userData: string, petId: string): Promise<void> {
  for (const state of PET_STATE_ORDER) {
    const width = 4;
    const height = 4;
    const pixelsA = transparentSprite(width, height, 1);
    const pixelsB = transparentSprite(width, height, 2);
    await writeGif(
      join(userData, "custom_pets", petId, "source", state, `${state}.gif`),
      gifBytes(width, height, [
        { pixels: pixelsA, delayCs: 4 },
        { pixels: pixelsB, delayCs: 9 }
      ])
    );
  }
}

async function writeDirectSourceBundle(userData: string, petId: string): Promise<void> {
  for (const state of PET_STATE_ORDER) {
    const width = 4;
    const height = 4;
    await writeGif(
      join(userData, "custom_pets", petId, "source", `${state}.gif`),
      gifBytes(width, height, [
        { pixels: transparentSprite(width, height, 1), delayCs: 4 },
        { pixels: transparentSprite(width, height, 2), delayCs: 9 }
      ])
    );
  }
}

function errorCodes(result: { errors: Array<{ code: string }> }): string[] {
  return result.errors.map((error) => error.code);
}

export const tests = [
  {
    name: "precheckRawGif rejects static GIFs",
    async run(): Promise<void> {
      const root = await tempDir();
      const file = join(root, "static.gif");
      await writeGif(file, gifBytes(4, 4, [{ pixels: transparentSprite(4, 4, 1) }]));

      const result = await precheckRawGif(file);

      assert.equal(result.ok, false);
      assert.ok(errorCodes(result).includes("gif_static"));
    }
  },
  {
    name: "precheckRawGif rejects GIFs without actual transparent pixels",
    async run(): Promise<void> {
      const root = await tempDir();
      const file = join(root, "opaque.gif");
      const opaquePixels = new Array(16).fill(1);
      await writeGif(file, gifBytes(4, 4, [{ pixels: opaquePixels }, { pixels: opaquePixels }], false));

      const result = await precheckRawGif(file);

      assert.equal(result.ok, false);
      assert.ok(errorCodes(result).includes("gif_no_transparency"));
    }
  },
  {
    name: "precheckRawGif enforces dimension caps",
    async run(): Promise<void> {
      const root = await tempDir();
      const file = join(root, "wide.gif");
      await writeGif(
        file,
        gifBytes(12, 4, [
          { pixels: transparentSprite(12, 4, 1) },
          { pixels: transparentSprite(12, 4, 2) }
        ])
      );

      const result = await precheckRawGif(file, { maxDimension: 8 });

      assert.equal(result.ok, false);
      assert.ok(errorCodes(result).includes("gif_dimensions_too_large"));
    }
  },
  {
    name: "precheckRawGif rejects file-size cap before decoding",
    async run(): Promise<void> {
      const root = await tempDir();
      const file = join(root, "oversized.gif");
      await writeGif(
        file,
        gifBytes(4, 4, [
          { pixels: transparentSprite(4, 4, 1) },
          { pixels: transparentSprite(4, 4, 2) }
        ])
      );

      const result = await precheckRawGif(file, { maxBytes: 1 });

      assert.equal(result.ok, false);
      assert.deepEqual(errorCodes(result), ["gif_file_too_large"]);
      assert.equal(result.width, 0);
      assert.equal(result.height, 0);
      assert.equal(result.frameCount, 0);
    }
  },
  {
    name: "normalizeCustomPetBundle requires all pet states and returns state errors",
    async run(): Promise<void> {
      const userData = await tempDir();
      const petId = "missing-state";
      await writeGif(
        join(userData, "custom_pets", petId, "source", "idle", "idle.gif"),
        gifBytes(4, 4, [
          { pixels: transparentSprite(4, 4, 1) },
          { pixels: transparentSprite(4, 4, 2) }
        ])
      );

      const result = await normalizeCustomPetBundle({ userDataPath: userData, petId, generationId: "gen-a" });

      assert.equal(result.ok, false);
      assert.ok(result.stateErrors.some((error) => error.state === "sitting" && error.code === "state_missing_source"));
    }
  },
  {
    name: "normalizeCustomPetBundle writes canonical 282 GIFs with locked scale",
    async run(): Promise<void> {
      const userData = await tempDir();
      const petId = "tiny-pet";
      await writeSourceBundle(userData, petId);

      const result = await normalizeCustomPetBundle({ userDataPath: userData, petId, generationId: "gen-b" });

      assert.equal(result.ok, true, JSON.stringify(result.stateErrors));
      assert.equal(Object.keys(result.outputs).length, PET_STATE_ORDER.length);

      const bounds: Array<{ width: number; height: number }> = [];
      for (const state of PET_STATE_ORDER as PetState[]) {
        const output = result.outputs[state];
        assert.equal(output?.relativePath, `custom_pets/${petId}/normalized/gen-b/${state}.gif`);
        assert.equal(output?.sourceRelativePath, `custom_pets/${petId}/source/${state}/${state}.gif`);

        const postcheck = await postcheckRuntimeGif(join(userData, output.relativePath), { state });
        assert.equal(postcheck.ok, true);
        assert.equal(postcheck.width, 282);
        assert.equal(postcheck.height, 282);
        assert.equal(postcheck.frameCount, 2);
        assert.ok(postcheck.contentBounds);
        bounds.push({
          width: postcheck.contentBounds.width,
          height: postcheck.contentBounds.height
        });
      }

      assert.equal(new Set(bounds.map((bound) => `${bound.width}x${bound.height}`)).size, 1);
      const outputDir = join(userData, "custom_pets", petId, "normalized", "gen-b");
      const leftoverTemps = (await readdir(outputDir)).filter((name) => name.includes(".tmp-"));
      assert.deepEqual(leftoverTemps, []);
    }
  },
  {
    name: "normalizeCustomPetBundle accepts Codex direct source GIF layout",
    async run(): Promise<void> {
      const userData = await tempDir();
      const petId = "direct-pet";
      await writeDirectSourceBundle(userData, petId);

      const result = await normalizeCustomPetBundle({ userDataPath: userData, petId, generationId: "gen-direct" });

      assert.equal(result.ok, true, JSON.stringify(result.stateErrors));
      assert.equal(result.outputs.idle?.sourceRelativePath, `custom_pets/${petId}/source/idle.gif`);
      assert.equal(result.outputs.quitRunning?.sourceRelativePath, `custom_pets/${petId}/source/quitRunning.gif`);
    }
  },
  {
    name: "normalizeCustomPetBundle propagates runtime postcheck failures",
    async run(): Promise<void> {
      const userData = await tempDir();
      const petId = "runtime-fail";
      await writeSourceBundle(userData, petId);

      const result = await normalizeCustomPetBundle({
        userDataPath: userData,
        petId,
        generationId: "gen-c",
        runtimePostcheck: { maxFrames: 1 }
      });

      assert.equal(result.ok, false);
      assert.ok(result.stateErrors.some((error) => error.state === "idle" && error.code === "runtime_frame_count_too_large"));
    }
  },
  {
    name: "postcheckRuntimeGif rejects non-normalized runtime GIF dimensions",
    async run(): Promise<void> {
      const root = await tempDir();
      const file = join(root, "small.gif");
      await writeGif(
        file,
        gifBytes(4, 4, [
          { pixels: transparentSprite(4, 4, 1) },
          { pixels: transparentSprite(4, 4, 2) }
        ])
      );

      const result = await postcheckRuntimeGif(file, { state: "idle" });

      assert.equal(result.ok, false);
      assert.deepEqual(result.errors[0], {
        state: "idle",
        code: "runtime_dimensions_invalid",
        message: "GIF must be 282x282."
      });
    }
  }
];
