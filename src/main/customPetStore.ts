import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PET_STATE_ORDER } from "../shared/petAppearances";
import type {
  CustomPetGenerationStatus,
  CustomPetJobSummary,
  CustomPetJobStateSummary,
  CustomPetLibrary,
  CustomPetManifest,
  PetState
} from "../shared/types";

export type CustomPetStore = {
  rootDir: string;
  indexPath: string;
  loadIndex(): Promise<CustomPetLibrary>;
  rebuildIndex(): Promise<CustomPetLibrary>;
  saveManifest(manifest: CustomPetManifest): Promise<void>;
  saveJobSummary(petId: string, job: CustomPetJobSummary): Promise<void>;
  softDeletePet(petId: string): Promise<string>;
};

const PET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function assertSafePetId(petId: string): void {
  if (!PET_ID_PATTERN.test(petId)) throw new Error(`Invalid pet id: ${petId}`);
}

function assertInside(parent: string, child: string): void {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  const childRelative = relative(resolvedParent, resolvedChild);
  if (childRelative.startsWith("..") || isAbsolute(childRelative)) {
    throw new Error(`Path escapes custom pet root: ${child}`);
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function isCustomPetGenerationStatus(value: unknown): value is CustomPetGenerationStatus {
  return value === "queued" || value === "running" || value === "needs_input" || value === "complete" || value === "error";
}

function isPetState(value: unknown): value is PetState {
  return typeof value === "string" && PET_STATE_ORDER.includes(value as PetState);
}

function normalizeJobState(value: unknown): CustomPetJobStateSummary | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (!isPetState(source.state) || !isCustomPetGenerationStatus(source.status)) return null;
  return {
    state: source.state,
    status: source.status,
    sourceRelativePath: typeof source.sourceRelativePath === "string" ? source.sourceRelativePath : undefined,
    normalizedRelativePath: typeof source.normalizedRelativePath === "string" ? source.normalizedRelativePath : undefined,
    error: typeof source.error === "string" ? source.error : null
  };
}

function normalizeJobSummary(petId: string, raw: unknown): CustomPetJobSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  if (source.petId !== petId || !isCustomPetGenerationStatus(source.status)) return null;
  const states: Partial<Record<PetState, CustomPetJobStateSummary>> = {};
  if (Array.isArray(source.states)) {
    for (const value of source.states) {
      const state = normalizeJobState(value);
      if (state) states[state.state] = state;
    }
  } else if (source.states && typeof source.states === "object") {
    for (const value of Object.values(source.states)) {
      const state = normalizeJobState(value);
      if (state) states[state.state] = state;
    }
  }
  return {
    petId,
    generationId:
      typeof source.generationId === "string"
        ? source.generationId
        : typeof source.id === "string"
          ? source.id
          : undefined,
    status: source.status,
    createdAt: typeof source.createdAt === "number" ? source.createdAt : undefined,
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : Date.now(),
    states: Object.keys(states).length ? states : undefined,
    error: typeof source.error === "string" ? source.error : null
  };
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export function createCustomPetStore(userDataDir: string): CustomPetStore {
  const rootDir = join(userDataDir, "custom_pets");
  const trashDir = join(rootDir, ".trash");
  const indexPath = join(rootDir, "index.json");

  function petDir(petId: string): string {
    assertSafePetId(petId);
    const path = join(rootDir, petId);
    assertInside(rootDir, path);
    return path;
  }

  async function rebuildIndex(): Promise<CustomPetLibrary> {
    await mkdir(trashDir, { recursive: true });
    const manifests: CustomPetLibrary["manifests"] = {};
    const jobs: NonNullable<CustomPetLibrary["jobs"]> = {};
    const entries = await readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".trash") continue;
      if (!PET_ID_PATTERN.test(entry.name)) continue;
      const dir = petDir(entry.name);
      const job = normalizeJobSummary(entry.name, await readJson<unknown>(join(dir, "job.json")));
      if (job) jobs[entry.name] = job;
      const manifest = await readJson<CustomPetManifest>(join(dir, "pet.json"));
      if (!manifest || manifest.id !== entry.name || !PET_ID_PATTERN.test(manifest.id)) continue;
      manifests[manifest.id] = manifest;
    }

    const index: CustomPetLibrary = { updatedAt: Date.now(), manifests, jobs };
    await writeJsonAtomic(indexPath, index);
    return index;
  }

  async function loadIndex(): Promise<CustomPetLibrary> {
    const cached = await readJson<CustomPetLibrary>(indexPath);
    if (cached?.manifests && typeof cached.updatedAt === "number") return cached;
    return rebuildIndex();
  }

  async function saveManifest(manifest: CustomPetManifest): Promise<void> {
    assertSafePetId(manifest.id);
    await writeJsonAtomic(join(petDir(manifest.id), "pet.json"), manifest);
    await rebuildIndex();
  }

  async function saveJobSummary(petId: string, job: CustomPetJobSummary): Promise<void> {
    assertSafePetId(petId);
    if (job.petId !== petId) throw new Error(`Job pet id mismatch: ${job.petId}`);
    await writeJsonAtomic(join(petDir(petId), "job.json"), job);
    await rebuildIndex();
  }

  async function softDeletePet(petId: string): Promise<string> {
    const source = petDir(petId);
    await mkdir(trashDir, { recursive: true });
    const target = join(trashDir, `${petId}-${Date.now()}`);
    assertInside(trashDir, target);
    await rename(source, target);
    await rebuildIndex();
    return target;
  }

  return {
    rootDir,
    indexPath,
    loadIndex,
    rebuildIndex,
    saveManifest,
    saveJobSummary,
    softDeletePet
  };
}
