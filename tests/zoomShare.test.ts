import assert from "node:assert/strict";
import { isZoomScreenSharingText, isZoomSharePermissionError } from "../src/main/zoomShare";

export const tests = [
  {
    name: "isZoomScreenSharingText detects active share controls",
    run(): void {
      assert.equal(isZoomScreenSharingText("Mute\nPause Share\nStop Share\nAnnotate"), true);
      assert.equal(isZoomScreenSharingText("You are screen sharing\nNew Share"), true);
      assert.equal(isZoomScreenSharingText("Participants can now see your screen"), true);
    }
  },
  {
    name: "isZoomScreenSharingText ignores idle meeting controls",
    run(): void {
      assert.equal(isZoomScreenSharingText("Join Audio\nShare Screen\nStart Video\nParticipants"), false);
      assert.equal(isZoomScreenSharingText("Zoom Workplace\nMeetings\nTeam Chat"), false);
    }
  },
  {
    name: "isZoomSharePermissionError detects macOS accessibility failures",
    run(): void {
      assert.equal(isZoomSharePermissionError(new Error("execution error: An error of type -10827 has occurred.")), true);
    }
  }
];
