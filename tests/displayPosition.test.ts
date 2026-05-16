import assert from "node:assert/strict";
import {
  horizontalRunTarget,
  initialWindowBounds,
  rightmostWorkArea,
  savedPositionFromBounds,
  visibleWindowBounds
} from "../src/main/displayPosition";
import type { DisplayBounds, WindowBounds } from "../src/main/displayPosition";

const primary: DisplayBounds = {
  id: 1,
  workArea: { x: 0, y: 0, width: 1440, height: 900 }
};

const secondary: DisplayBounds = {
  id: 2,
  workArea: { x: 1440, y: 0, width: 1280, height: 900 }
};

const leftDisplay: DisplayBounds = {
  id: 3,
  workArea: { x: -1512, y: 0, width: 1512, height: 982 }
};

const petSize = { width: 220, height: 340 };

export const tests = [
  {
    name: "visibleWindowBounds moves a pet from a removed display back into the primary work area",
    run(): void {
      const offscreen: WindowBounds = { ...petSize, x: 2400, y: 560 };

      const bounds = visibleWindowBounds([primary], primary, offscreen);

      assert.equal(bounds.x, 1220);
      assert.equal(bounds.y, 560);
    }
  },
  {
    name: "visibleWindowBounds can allow transparent side gutters past horizontal edges",
    run(): void {
      const bounds = visibleWindowBounds(
        [primary],
        primary,
        { width: 360, height: 390, x: 1200, y: 510 },
        { left: 88, right: 88 }
      );

      assert.equal(bounds.x, 1168);
      assert.equal(bounds.y, 510);
    }
  },
  {
    name: "savedPositionFromBounds stores display id and relative coordinates",
    run(): void {
      const saved = savedPositionFromBounds(
        [primary, secondary],
        { ...petSize, x: 2080, y: 280 },
        primary
      );

      assert.equal(saved.displayId, secondary.id);
      assert.ok(typeof saved.relativeX === "number");
      assert.ok(typeof saved.relativeY === "number");
    }
  },
  {
    name: "initialWindowBounds restores relative position on the same display after resolution changes",
    run(): void {
      const saved = savedPositionFromBounds(
        [primary, secondary],
        { ...petSize, x: 2080, y: 280 },
        primary
      );
      const resizedSecondary: DisplayBounds = {
        id: secondary.id,
        workArea: { x: 1440, y: 0, width: 1600, height: 1000 }
      };

      const restored = initialWindowBounds({
        displays: [primary, resizedSecondary],
        primaryDisplay: primary,
        size: petSize,
        saved
      });

      assert.equal(restored.x > resizedSecondary.workArea.x, true);
      assert.equal(restored.x < resizedSecondary.workArea.x + resizedSecondary.workArea.width, true);
      assert.equal(restored.y > resizedSecondary.workArea.y, true);
      assert.equal(restored.y < resizedSecondary.workArea.y + resizedSecondary.workArea.height, true);
    }
  },
  {
    name: "initialWindowBounds falls back to nearest visible display when the saved display no longer exists",
    run(): void {
      const bounds = initialWindowBounds({
        displays: [primary],
        primaryDisplay: primary,
        size: petSize,
        saved: {
          x: 2400,
          y: 560,
          displayId: secondary.id,
          relativeX: 0.5,
          relativeY: 1
        }
      });

      assert.equal(bounds.x, 1220);
      assert.equal(bounds.y, 560);
    }
  },
  {
    name: "rightmostWorkArea picks the far-right display when another display sits left of primary",
    run(): void {
      const workArea = rightmostWorkArea([primary, leftDisplay], primary);

      assert.deepEqual(workArea, primary.workArea);
    }
  },
  {
    name: "horizontalRunTarget exits right when pet is on the left half of the left display",
    run(): void {
      const target = horizontalRunTarget([leftDisplay, primary], primary, {
        ...petSize,
        x: -1400,
        y: 560
      });

      assert.deepEqual(target, { endX: 1464, facing: "right" });
    }
  },
  {
    name: "horizontalRunTarget exits left when pet is on the right half of the left display",
    run(): void {
      const target = horizontalRunTarget([leftDisplay, primary], primary, {
        ...petSize,
        x: -360,
        y: 560
      });

      assert.deepEqual(target, { endX: -1756, facing: "left" });
    }
  },
  {
    name: "horizontalRunTarget exits right when pet is on the left half of the right display",
    run(): void {
      const target = horizontalRunTarget([leftDisplay, primary], primary, {
        ...petSize,
        x: 120,
        y: 560
      });

      assert.deepEqual(target, { endX: 1464, facing: "right" });
    }
  },
  {
    name: "horizontalRunTarget exits left when pet is on the right half of the right display",
    run(): void {
      const target = horizontalRunTarget([leftDisplay, primary], primary, {
        ...petSize,
        x: 1100,
        y: 560
      });

      assert.deepEqual(target, { endX: -1756, facing: "left" });
    }
  }
];
