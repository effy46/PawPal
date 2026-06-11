import assert from "node:assert/strict";
import { isZoomSharePermissionError, zoomShareStatusFromOutput } from "../src/main/zoomShare";

export const tests = [
  {
    name: "zoomShareStatusFromOutput treats the CptHost sentinel as sharing",
    run(): void {
      assert.deepEqual(zoomShareStatusFromOutput("PAWPAL_CPTHOST_ACTIVE\n"), {
        state: "sharing",
        rawText: "PAWPAL_CPTHOST_ACTIVE\n"
      });
    }
  },
  {
    name: "zoomShareStatusFromOutput treats anything else as not sharing",
    run(): void {
      assert.deepEqual(zoomShareStatusFromOutput(""), { state: "not-sharing", rawText: "" });
      assert.deepEqual(zoomShareStatusFromOutput("Join Audio\nShare Screen\n"), {
        state: "not-sharing",
        rawText: "Join Audio\nShare Screen\n"
      });
    }
  },
  {
    name: "isZoomSharePermissionError detects macOS permission failures",
    run(): void {
      assert.equal(isZoomSharePermissionError(new Error("execution error: An error of type -10827 has occurred.")), true);
      assert.equal(isZoomSharePermissionError(new Error("Not authorized to send Apple events to System Events. (-1743)")), true);
      assert.equal(isZoomSharePermissionError(new Error("osascript is NOT ALLOWED assistive access")), true);
      assert.equal(isZoomSharePermissionError(new Error("some unrelated failure")), false);
    }
  }
];
