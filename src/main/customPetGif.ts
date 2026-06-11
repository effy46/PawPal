import { createRequire } from "node:module";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { decompressFrames, parseGIF, type ParsedFrame } from "gifuct-js";
import { PET_STATE_ORDER } from "../shared/petAppearances";
import type { PetState } from "../shared/types";

const require = createRequire(import.meta.url);
const { GIFEncoder, applyPalette, quantize } = require("gifenc") as {
  GIFEncoder: () => {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        palette: number[][];
        transparent: boolean;
        transparentIndex: number;
        delay: number;
        repeat?: number;
      }
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  applyPalette: (rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: "rgba4444") => Uint8Array;
  quantize: (
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format: "rgba4444"; oneBitAlpha: number; clearAlpha: boolean }
  ) => number[][];
};

const NORMALIZED_SIZE = 282;
const SAFE_AREA_SIZE = 250;
const SAFE_MARGIN = Math.floor((NORMALIZED_SIZE - SAFE_AREA_SIZE) / 2);

const DEFAULT_PRECHECK_OPTIONS = {
  maxBytes: 8 * 1024 * 1024,
  maxFrames: 120,
  maxDimension: 1024,
  maxRatio: 1.4,
  maxDecodedPixels: 20_000_000
};

export type CustomPetGifErrorCode =
  | "gif_unreadable"
  | "gif_not_gif"
  | "gif_static"
  | "gif_no_transparency"
  | "gif_no_visible_pixels"
  | "gif_file_too_large"
  | "gif_frame_count_too_large"
  | "gif_dimensions_too_large"
  | "gif_ratio_not_squareish"
  | "gif_decode_too_large"
  | "state_missing_source"
  | "state_precheck_failed"
  | "runtime_dimensions_invalid"
  | "runtime_static"
  | "runtime_frame_count_too_large"
  | "runtime_no_transparency"
  | "runtime_alpha_edge_overflow";

export type CustomPetGifError = {
  state?: PetState;
  code: CustomPetGifErrorCode;
  message: string;
};

export type GifBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type PrecheckRawGifOptions = Partial<typeof DEFAULT_PRECHECK_OPTIONS>;

export type PrecheckRawGifResult = {
  ok: boolean;
  path: string;
  width: number;
  height: number;
  frameCount: number;
  fileSize: number;
  contentBounds: GifBounds | null;
  errors: CustomPetGifError[];
};

export type NormalizeCustomPetBundleOptions = {
  userDataPath: string;
  petId: string;
  generationId: string;
  precheck?: PrecheckRawGifOptions;
  runtimePostcheck?: Omit<PostcheckRuntimeGifOptions, "state">;
};

export type NormalizedCustomPetOutput = {
  state: PetState;
  relativePath: string;
  sourceRelativePath: string;
  scale: number;
};

export type NormalizeCustomPetBundleResult = {
  ok: boolean;
  petId: string;
  generationId: string;
  outputs: Partial<Record<PetState, NormalizedCustomPetOutput>>;
  stateErrors: Array<CustomPetGifError & { state: PetState }>;
};

export type PostcheckRuntimeGifOptions = {
  state?: PetState;
  maxFrames?: number;
};

export type PostcheckRuntimeGifResult = {
  ok: boolean;
  path: string;
  state?: PetState;
  width: number;
  height: number;
  frameCount: number;
  contentBounds: GifBounds | null;
  errors: CustomPetGifError[];
};

type DecodedGif = {
  path: string;
  bytes: Buffer;
  width: number;
  height: number;
  frames: DecodedFrame[];
  contentBounds: GifBounds | null;
  hasTransparentPixels: boolean;
  hasVisiblePixels: boolean;
};

type DecodedFrame = {
  rgba: Uint8ClampedArray;
  delayMs: number;
};

function error(code: CustomPetGifErrorCode, message: string, state?: PetState): CustomPetGifError {
  return state ? { state, code, message } : { code, message };
}

function mergeOptions(options: PrecheckRawGifOptions = {}): typeof DEFAULT_PRECHECK_OPTIONS {
  return { ...DEFAULT_PRECHECK_OPTIONS, ...options };
}

function arrayBufferFromBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

function isSafeSegment(value: string): boolean {
  return Boolean(value) && !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..";
}

function relativeSourcePath(petId: string, state: PetState, sourceName: string): string {
  return `custom_pets/${petId}/source/${state}/${sourceName}`;
}

function relativeDirectSourcePath(petId: string, state: PetState): string {
  return `custom_pets/${petId}/source/${state}.gif`;
}

function relativeNormalizedPath(petId: string, generationId: string, state: PetState): string {
  return `custom_pets/${petId}/normalized/${generationId}/${state}.gif`;
}

function frameDelay(frame: ParsedFrame): number {
  return Math.max(20, Number.isFinite(frame.delay) && frame.delay > 0 ? frame.delay : 80);
}

function setPixel(target: Uint8ClampedArray, width: number, x: number, y: number, source: Uint8ClampedArray, offset: number): void {
  const targetOffset = (y * width + x) * 4;
  target[targetOffset] = source[offset];
  target[targetOffset + 1] = source[offset + 1];
  target[targetOffset + 2] = source[offset + 2];
  target[targetOffset + 3] = source[offset + 3];
}

function composeFrames(width: number, height: number, frames: ParsedFrame[]): DecodedFrame[] {
  const canvas = new Uint8ClampedArray(width * height * 4);
  const decoded: DecodedFrame[] = [];

  for (const frame of frames) {
    const beforeFrame = frame.disposalType === 3 ? new Uint8ClampedArray(canvas) : null;
    const { left, top, width: frameWidth, height: frameHeight } = frame.dims;

    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        const patchOffset = (y * frameWidth + x) * 4;
        if (frame.patch[patchOffset + 3] === 0) continue;
        const targetX = left + x;
        const targetY = top + y;
        if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
        setPixel(canvas, width, targetX, targetY, frame.patch, patchOffset);
      }
    }

    decoded.push({
      rgba: new Uint8ClampedArray(canvas),
      delayMs: frameDelay(frame)
    });

    if (frame.disposalType === 2) {
      for (let y = 0; y < frameHeight; y += 1) {
        for (let x = 0; x < frameWidth; x += 1) {
          const targetX = left + x;
          const targetY = top + y;
          if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
          const targetOffset = (targetY * width + targetX) * 4;
          canvas[targetOffset] = 0;
          canvas[targetOffset + 1] = 0;
          canvas[targetOffset + 2] = 0;
          canvas[targetOffset + 3] = 0;
        }
      }
    } else if (beforeFrame) {
      canvas.set(beforeFrame);
    }
  }

  return decoded;
}

function scanBounds(width: number, height: number, frames: DecodedFrame[]): {
  bounds: GifBounds | null;
  hasTransparentPixels: boolean;
  hasVisiblePixels: boolean;
} {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let hasTransparentPixels = false;
  let hasVisiblePixels = false;

  for (const frame of frames) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = frame.rgba[(y * width + x) * 4 + 3];
        if (alpha === 0) {
          hasTransparentPixels = true;
          continue;
        }
        hasVisiblePixels = true;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  return {
    bounds: hasVisiblePixels
      ? {
          left,
          top,
          right,
          bottom,
          width: right - left + 1,
          height: bottom - top + 1
        }
      : null,
    hasTransparentPixels,
    hasVisiblePixels
  };
}

async function decodeGif(path: string, options: PrecheckRawGifOptions = {}): Promise<{ decoded: DecodedGif | null; errors: CustomPetGifError[]; fileSize: number; width: number; height: number; frameCount: number }> {
  const limits = mergeOptions(options);
  const errors: CustomPetGifError[] = [];
  let bytes: Buffer;
  let fileSize = 0;

  try {
    const info = await stat(path);
    fileSize = info.size;
    if (info.size > limits.maxBytes) {
      return {
        decoded: null,
        errors: [error("gif_file_too_large", `GIF must be ${limits.maxBytes} bytes or smaller.`)],
        fileSize,
        width: 0,
        height: 0,
        frameCount: 0
      };
    }
    bytes = await readFile(path);
  } catch {
    return {
      decoded: null,
      errors: [error("gif_unreadable", "GIF could not be read.")],
      fileSize,
      width: 0,
      height: 0,
      frameCount: 0
    };
  }

  if (bytes.subarray(0, 3).toString("ascii") !== "GIF") {
    return {
      decoded: null,
      errors: [error("gif_not_gif", "File is not a GIF.")],
      fileSize,
      width: 0,
      height: 0,
      frameCount: 0
    };
  }

  try {
    const parsed = parseGIF(arrayBufferFromBuffer(bytes));
    const width = parsed.lsd.width;
    const height = parsed.lsd.height;
    const frameCount = parsed.frames.filter((frame) => "image" in frame).length;
    const ratio = Math.max(width / height, height / width);

    if (frameCount < 2) errors.push(error("gif_static", "GIF must have at least 2 frames."));
    if (frameCount > limits.maxFrames) {
      errors.push(error("gif_frame_count_too_large", `GIF must have ${limits.maxFrames} frames or fewer.`));
    }
    if (width > limits.maxDimension || height > limits.maxDimension) {
      errors.push(error("gif_dimensions_too_large", `GIF dimensions must be ${limits.maxDimension}px or smaller.`));
    }
    if (ratio > limits.maxRatio) {
      errors.push(error("gif_ratio_not_squareish", "GIF must be roughly square."));
    }
    if (width * height * Math.max(frameCount, 1) > limits.maxDecodedPixels) {
      errors.push(error("gif_decode_too_large", "GIF decoded pixel budget is too large."));
    }

    const fatal = errors.some((item) =>
      ["gif_frame_count_too_large", "gif_dimensions_too_large", "gif_decode_too_large"].includes(item.code)
    );
    if (fatal) {
      return { decoded: null, errors, fileSize, width, height, frameCount };
    }

    const rawFrames = decompressFrames(parsed, true);
    const frames = composeFrames(width, height, rawFrames);
    const scan = scanBounds(width, height, frames);
    const patchHasTransparentPixels = rawFrames.some((frame) => {
      if (typeof frame.transparentIndex !== "number") return false;
      for (let offset = 3; offset < frame.patch.length; offset += 4) {
        if (frame.patch[offset] === 0) return true;
      }
      return false;
    });

    if (!patchHasTransparentPixels) errors.push(error("gif_no_transparency", "GIF must include actual transparent pixels."));
    if (!scan.hasVisiblePixels) errors.push(error("gif_no_visible_pixels", "GIF must include visible pixels."));

    return {
      decoded: {
        path,
        bytes,
        width,
        height,
        frames,
        contentBounds: scan.bounds,
        hasTransparentPixels: patchHasTransparentPixels || scan.hasTransparentPixels,
        hasVisiblePixels: scan.hasVisiblePixels
      },
      errors,
      fileSize,
      width,
      height,
      frameCount
    };
  } catch {
    return {
      decoded: null,
      errors: [error("gif_unreadable", "GIF could not be decoded.")],
      fileSize,
      width: 0,
      height: 0,
      frameCount: 0
    };
  }
}

export async function precheckRawGif(path: string, options: PrecheckRawGifOptions = {}): Promise<PrecheckRawGifResult> {
  const result = await decodeGif(path, options);
  return {
    ok: result.errors.length === 0,
    path,
    width: result.width,
    height: result.height,
    frameCount: result.frameCount,
    fileSize: result.fileSize,
    contentBounds: result.decoded?.contentBounds ?? null,
    errors: result.errors
  };
}

async function findSourceGif(userDataPath: string, petId: string, state: PetState): Promise<string | null> {
  const directPath = join(userDataPath, "custom_pets", petId, "source", `${state}.gif`);
  try {
    if ((await stat(directPath)).isFile()) return directPath;
  } catch {
    // Fall back to manual-import layout below.
  }

  const stateRoot = join(userDataPath, "custom_pets", petId, "source", state);
  try {
    const entries = await readdir(stateRoot, { withFileTypes: true });
    const gifs = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".gif"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    return gifs[0] ? join(stateRoot, gifs[0]) : null;
  } catch {
    return null;
  }
}

function normalizeFrame(frame: DecodedFrame, sourceWidth: number, bounds: GifBounds, scale: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(NORMALIZED_SIZE * NORMALIZED_SIZE * 4);
  const targetWidth = Math.max(1, Math.round(bounds.width * scale));
  const targetHeight = Math.max(1, Math.round(bounds.height * scale));
  const targetLeft = Math.round((NORMALIZED_SIZE - targetWidth) / 2);
  const targetTop = Math.round((NORMALIZED_SIZE - targetHeight) / 2);

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = bounds.top + Math.min(bounds.height - 1, Math.floor(y / scale));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = bounds.left + Math.min(bounds.width - 1, Math.floor(x / scale));
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const alpha = frame.rgba[sourceOffset + 3];
      if (alpha === 0) continue;
      const targetOffset = ((targetTop + y) * NORMALIZED_SIZE + targetLeft + x) * 4;
      output[targetOffset] = frame.rgba[sourceOffset];
      output[targetOffset + 1] = frame.rgba[sourceOffset + 1];
      output[targetOffset + 2] = frame.rgba[sourceOffset + 2];
      output[targetOffset + 3] = alpha;
    }
  }

  return output;
}

function encodeGif(frames: Array<{ rgba: Uint8ClampedArray; delayMs: number }>): Uint8Array {
  const gif = GIFEncoder();

  frames.forEach((frame, index) => {
    const palette = quantize(frame.rgba, 255, {
      format: "rgba4444",
      oneBitAlpha: 127,
      clearAlpha: true
    });
    palette.unshift([0, 0, 0, 0]);
    const indexed = applyPalette(frame.rgba, palette, "rgba4444");
    for (let pixel = 0; pixel < frame.rgba.length / 4; pixel += 1) {
      if (frame.rgba[pixel * 4 + 3] === 0) indexed[pixel] = 0;
    }
    gif.writeFrame(indexed, NORMALIZED_SIZE, NORMALIZED_SIZE, {
      palette,
      transparent: true,
      transparentIndex: 0,
      delay: frame.delayMs,
      repeat: index === 0 ? 0 : undefined
    });
  });

  gif.finish();
  return gif.bytes();
}

async function atomicWriteFile(path: string, bytes: Uint8Array): Promise<void> {
  const directory = dirname(path);
  const tempPath = join(
    directory,
    `.${basename(path)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  try {
    await writeFile(tempPath, bytes);
    await rename(tempPath, path);
  } catch (err) {
    await unlink(tempPath).catch(() => undefined);
    throw err;
  }
}

export async function normalizeCustomPetBundle(
  options: NormalizeCustomPetBundleOptions
): Promise<NormalizeCustomPetBundleResult> {
  const { userDataPath, petId, generationId } = options;
  const outputs: Partial<Record<PetState, NormalizedCustomPetOutput>> = {};
  const stateErrors: Array<CustomPetGifError & { state: PetState }> = [];
  const decodedByState = new Map<PetState, { sourcePath: string; decoded: DecodedGif }>();

  if (!isSafeSegment(petId) || !isSafeSegment(generationId)) {
    throw new Error("petId and generationId must be safe path segments.");
  }

  for (const state of PET_STATE_ORDER) {
    const sourcePath = await findSourceGif(userDataPath, petId, state);
    if (!sourcePath) {
      stateErrors.push({ state, ...error("state_missing_source", `Missing source GIF for ${state}.`) });
      continue;
    }

    const precheck = await decodeGif(sourcePath, options.precheck);
    if (!precheck.decoded || precheck.errors.length > 0) {
      stateErrors.push(
        ...precheck.errors.map((item) => ({
          state,
          code: item.code === "gif_unreadable" ? "state_precheck_failed" : item.code,
          message: item.message
        }))
      );
      continue;
    }

    decodedByState.set(state, { sourcePath, decoded: precheck.decoded });
  }

  if (stateErrors.length > 0) {
    return { ok: false, petId, generationId, outputs, stateErrors };
  }

  const allBounds = [...decodedByState.values()].map((entry) => entry.decoded.contentBounds).filter(Boolean) as GifBounds[];
  const maxContentWidth = Math.max(...allBounds.map((bounds) => bounds.width));
  const maxContentHeight = Math.max(...allBounds.map((bounds) => bounds.height));
  const lockedScale = Math.min(SAFE_AREA_SIZE / maxContentWidth, SAFE_AREA_SIZE / maxContentHeight);

  for (const state of PET_STATE_ORDER) {
    const entry = decodedByState.get(state);
    if (!entry?.decoded.contentBounds) continue;
    const frames = entry.decoded.frames.map((frame) => ({
      rgba: normalizeFrame(frame, entry.decoded.width, entry.decoded.contentBounds as GifBounds, lockedScale),
      delayMs: frame.delayMs
    }));
    const relativePath = relativeNormalizedPath(petId, generationId, state);
    const outputPath = join(userDataPath, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await atomicWriteFile(outputPath, encodeGif(frames));
    outputs[state] = {
      state,
      relativePath,
      sourceRelativePath:
        entry.sourcePath === join(userDataPath, "custom_pets", petId, "source", `${state}.gif`)
          ? relativeDirectSourcePath(petId, state)
          : relativeSourcePath(petId, state, basename(entry.sourcePath)),
      scale: lockedScale
    };
    const postcheck = await postcheckRuntimeGif(outputPath, { ...options.runtimePostcheck, state });
    if (!postcheck.ok) {
      stateErrors.push(
        ...postcheck.errors.map((item) => ({
          state,
          code: item.code,
          message: item.message
        }))
      );
    }
  }

  return { ok: stateErrors.length === 0, petId, generationId, outputs, stateErrors };
}

export async function postcheckRuntimeGif(
  path: string,
  options: PostcheckRuntimeGifOptions = {}
): Promise<PostcheckRuntimeGifResult> {
  const decoded = await decodeGif(path, {
    maxDimension: NORMALIZED_SIZE,
    maxRatio: 1,
    maxFrames: options.maxFrames ?? DEFAULT_PRECHECK_OPTIONS.maxFrames
  });
  const state = options.state;
  const errors: CustomPetGifError[] = decoded.errors
    .filter((item) => !["gif_dimensions_too_large", "gif_ratio_not_squareish"].includes(item.code))
    .map((item) =>
      item.code === "gif_frame_count_too_large"
        ? error("runtime_frame_count_too_large", item.message, state)
        : error(item.code, item.message, state)
    );

  if (decoded.width !== NORMALIZED_SIZE || decoded.height !== NORMALIZED_SIZE) {
    errors.unshift(error("runtime_dimensions_invalid", "GIF must be 282x282.", state));
  }
  if (decoded.frameCount < 2) errors.push(error("runtime_static", "Runtime GIF must be animated.", state));
  if (!decoded.decoded?.hasTransparentPixels) {
    errors.push(error("runtime_no_transparency", "Runtime GIF must preserve transparent pixels.", state));
  }

  const bounds = decoded.decoded?.contentBounds ?? null;
  if (
    bounds &&
    (bounds.left < SAFE_MARGIN ||
      bounds.top < SAFE_MARGIN ||
      bounds.right >= SAFE_MARGIN + SAFE_AREA_SIZE ||
      bounds.bottom >= SAFE_MARGIN + SAFE_AREA_SIZE)
  ) {
    errors.push(error("runtime_alpha_edge_overflow", "Visible pixels must stay inside the 250x250 safe area.", state));
  }

  return {
    ok: errors.length === 0,
    path,
    state,
    width: decoded.width,
    height: decoded.height,
    frameCount: decoded.frameCount,
    contentBounds: bounds,
    errors
  };
}
