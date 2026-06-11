import {
  getPetAssetDefinition,
  resolvePetAppearanceId
} from "../../shared/petAppearances";
import type {
  CustomPetAppearance,
  CustomPetLibrary,
  CustomPetManifest,
  PetAppearanceId,
  PetFacing,
  PetState
} from "../../shared/types";

const warnedPlaceholders = new Set<string>();

export type PetAsset = {
  src: string;
  isPlaceholder: boolean;
  replayIntervalMs?: number;
  displayScale?: number;
  displayYOffset?: number;
};

export type PetAssetSource = CustomPetAppearance | CustomPetManifest | CustomPetLibrary | null | undefined;

function normalizeAssetPaths(path: string | string[]): string[] {
  return Array.isArray(path) ? path : [path];
}

export function getPetAssetVariantCount(
  appearanceId: PetAppearanceId,
  state: PetState,
  custom?: PetAssetSource
): number {
  const resolvedAppearanceId = resolvePetAppearanceId(appearanceId);
  const asset = getPetAssetDefinition(resolvedAppearanceId, state, custom);
  return normalizeAssetPaths(asset.path).length;
}

export function getPetAsset(
  appearanceId: PetAppearanceId,
  state: PetState,
  variantIndex = 0,
  replayKey = 0,
  custom?: PetAssetSource,
  facing?: PetFacing
): PetAsset {
  const resolvedAppearanceId = resolvePetAppearanceId(appearanceId);
  const asset = getPetAssetDefinition(resolvedAppearanceId, state, custom);
  const paths = normalizeAssetPaths(asset.path);
  const selectedPath = paths[Math.abs(variantIndex) % paths.length];
  const warningKey = `${resolvedAppearanceId}:${state}`;

  if (asset.isPlaceholder && !warnedPlaceholders.has(warningKey)) {
    warnedPlaceholders.add(warningKey);
    console.warn(`PawPal is using a placeholder asset for ${warningKey}.`);
  }

  const src = new URL(window.pawpal.assetUrl(selectedPath));
  if (replayKey > 0) {
    src.searchParams.set("pawpalReplay", String(replayKey));
  }

  return {
    src: src.href,
    isPlaceholder: Boolean(asset.isPlaceholder),
    replayIntervalMs: asset.replayIntervalMs,
    displayScale: asset.displayScale,
    displayYOffset: asset.displayYOffset
  };
}
