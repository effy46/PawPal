# Break Run Return-to-Origin — Design

Date: 2026-06-11
Status: approved (Fiona, in-session — "approach A")

## Goal

After the stand-up break run (pet zoomies across the screen), the pet runs back to the
position it started from instead of stopping wherever it happens to be.

## Approach (A — animated run-back)

All in `src/main/main.ts`; no settings, schema, or i18n changes.

1. **Record origin.** `startBreakRun()` stores `breakRunOrigin = { x, y }` from the pet
   window bounds (after `ensurePetWindowVisible()`).
2. **Return leg.** The duration timer now fires `startBreakRunReturn()` instead of
   `finishBreakRun()`:
   - stop the wander movement timer and the countdown timer; hide the countdown bubble;
   - re-clamp the origin via `visibleWindowBounds` (display layout may have changed mid-run);
   - tick `movePetForBreakRunReturn()` on the same `BREAK_RUN_TICK_MS` cadence: constant
     speed (6.4 px/tick, top of the wander speed range) straight toward the origin,
     facing follows the x direction;
   - arrival (remaining distance ≤ one step) → snap exactly onto the origin, then
     `finishBreakRun()` (unchanged: "break done" bubble, `breakDone` → `idle`).
3. **Safety cap.** A 5 s timeout on the return leg snaps the pet to the origin and
   finishes, so the pet can never be stuck in `breakRun` blocking mode.
4. **State teardown.** `clearBreakRunTimers()` also clears the return timers;
   `finishBreakRun()` resets `breakRunOrigin`. `blockingMode === "breakRun"` persists
   through the return leg, so drag/resize stay blocked until the pet is home.

## Edge cases

- Display layout changed during the run → origin re-clamped to visible area before return.
- Pet window destroyed/hidden mid-return → finish immediately (same guard as the wander tick).
- Drag during run is already blocked, so the recorded origin cannot go stale.
- Persisted pet position is untouched by the run (only drags persist), so returning to the
  origin keeps the on-disk position consistent with reality.

## Testing

Movement runs on Electron window APIs inside main.ts and has no unit-test seam (matches
the existing untested wander logic). Verification: typecheck + full suite green, plus a
live run with a short `breakRunDurationSeconds` confirming the pet ends where it began.

## Out of scope

New pet states/animations for the return leg (`breakRunning` is reused), settings to
toggle the behavior, secondary-pet behavior changes.
