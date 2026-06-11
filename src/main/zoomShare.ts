import { execFile } from "node:child_process";

export type ZoomShareStatus =
  | { state: "sharing" | "not-sharing"; rawText: string }
  | { state: "permission-needed" | "error"; error: string };

// Zoom hosts the outbound share toolbar ("You are screen sharing") in a separate
// CptHost process. The process itself runs for the whole meeting, but it only owns
// on-screen windows (toolbar, green border) while a share is active — so the signal
// is "CptHost has an on-screen window". CGWindowList ownership needs no TCC
// permission at all (no Accessibility, no Automation), unlike crawling zoom.us's UI
// tree, which times out mid-share (AppleEvent -1712) and whose Accessibility grant
// goes stale on every ad-hoc rebuild.
export const ZOOM_SHARE_CPTHOST_SENTINEL = "PAWPAL_CPTHOST_ACTIVE";

const ZOOM_SHARE_SCRIPT = `
ObjC.import("CoreGraphics");
function run() {
  var ref = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID);
  var list = ObjC.deepUnwrap(ObjC.castRefToObject(ref)) || [];
  for (var i = 0; i < list.length; i += 1) {
    if ((list[i].kCGWindowOwnerName || "") === "CptHost") return "${ZOOM_SHARE_CPTHOST_SENTINEL}";
  }
  return "";
}
`;

export function isZoomSharePermissionError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("not allowed assistive access") ||
    message.includes("system events got an error") ||
    message.includes("not authorized") ||
    message.includes("operation not permitted") ||
    message.includes("-10827") ||
    message.includes("-1743")
  );
}

export function zoomShareStatusFromOutput(stdout: string): ZoomShareStatus {
  return {
    state: stdout.trim() === ZOOM_SHARE_CPTHOST_SENTINEL ? "sharing" : "not-sharing",
    rawText: stdout
  };
}

export function readZoomShareStatus(): Promise<ZoomShareStatus> {
  if (process.platform !== "darwin") {
    return Promise.resolve({ state: "not-sharing", rawText: "" });
  }

  return new Promise((resolveStatus) => {
    execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", ZOOM_SHARE_SCRIPT], { timeout: 3500 }, (error, stdout) => {
      if (error) {
        resolveStatus({
          state: isZoomSharePermissionError(error) ? "permission-needed" : "error",
          error: error.message
        });
        return;
      }
      resolveStatus(zoomShareStatusFromOutput(stdout));
    });
  });
}
