import { execFile } from "node:child_process";

export type ZoomShareStatus =
  | { state: "sharing" | "not-sharing"; rawText: string }
  | { state: "permission-needed" | "error"; error: string };

const ZOOM_PROCESS_NAMES = ["zoom.us", "Zoom Workplace", "Zoom"];
const STRONG_SHARE_INDICATORS = [
  "stop share",
  "pause share",
  "you are screen sharing",
  "you are sharing",
  "can now see your screen",
  "screen sharing"
];

function zoomShareScript(): string {
  const processNames = ZOOM_PROCESS_NAMES.map((name) => `"${name}"`).join(", ");
  return `
set zoomProcess to missing value
tell application "System Events"
  repeat with processName in {${processNames}}
    set processNameText to processName as text
    if exists application process processNameText then
      set zoomProcess to application process processNameText
      exit repeat
    end if
  end repeat
  if zoomProcess is missing value then return ""
  tell zoomProcess
    set allText to ""
    try
      set allText to allText & ((name of every window) as text) & linefeed
    end try
    try
      set allText to allText & ((name of every menu item of every menu of every menu bar) as text) & linefeed
    end try
    try
      set allElements to entire contents of every window
      repeat with itemRef in allElements
        try
          set itemName to name of itemRef
          if itemName is not missing value then set allText to allText & (itemName as text) & linefeed
        end try
        try
          set itemValue to value of itemRef
          if itemValue is not missing value then set allText to allText & (itemValue as text) & linefeed
        end try
        try
          set itemDescription to description of itemRef
          if itemDescription is not missing value then set allText to allText & (itemDescription as text) & linefeed
        end try
      end repeat
    end try
    return allText
  end tell
end tell
return ""
`;
}

export function isZoomScreenSharingText(rawText: string): boolean {
  const text = rawText.toLowerCase();
  return STRONG_SHARE_INDICATORS.some((indicator) => text.includes(indicator));
}

export function isZoomSharePermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("not allowed assistive access") ||
    message.includes("System Events got an error") ||
    message.includes("not authorized") ||
    message.includes("Operation not permitted") ||
    message.includes("-10827")
  );
}

export function readZoomShareStatus(): Promise<ZoomShareStatus> {
  if (process.platform !== "darwin") {
    return Promise.resolve({ state: "not-sharing", rawText: "" });
  }

  return new Promise((resolveStatus) => {
    execFile("/usr/bin/osascript", ["-e", zoomShareScript()], { timeout: 3500 }, (error, stdout) => {
      if (error) {
        resolveStatus({
          state: isZoomSharePermissionError(error) ? "permission-needed" : "error",
          error: error.message
        });
        return;
      }
      resolveStatus({
        state: isZoomScreenSharingText(stdout) ? "sharing" : "not-sharing",
        rawText: stdout
      });
    });
  });
}
