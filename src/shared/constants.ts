import type { Settings, TodayStats } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  language: "zh-CN",
  petAppearanceId: "lineDog",
  customPetAppearance: null,
  primaryAgentSource: "codex",
  dualAgentModeEnabled: false,
  secondaryPetAppearanceId: "xiaoJiMao",
  secondaryAgentSource: "claude-code",
  onboardingDismissed: false,
  launchAtLoginEnabled: false,
  checkUpdatesOnLaunchEnabled: false,
  zoomShareAutoHideEnabled: false,
  zoomMeetingReminderEnabled: false,
  zoomMeetingIcsUrl: "",
  zoomMeetingAppleCalendarEnabled: false,
  zoomMeetingReminderLeadMinutes: 2,
  agentActivityRetentionMinutes: 5,
  breakReminderEnabled: true,
  breakIntervalMinutes: 45,
  breakRunDurationSeconds: 60,
  hydrationReminderEnabled: true,
  hydrationIntervalMinutes: 90,
  dailyWaterGoal: 3,
  focusDurationMinutes: 25,
  distractionDetectionEnabled: false,
  distractionGraceSeconds: 8,
  distractionBlockedApps: [
    "Steam",
    "Discord",
    "Telegram",
    "WeChat",
    "QQ"
  ],
  distractionBlockedKeywords: [
    "youtube",
    "youtu.be",
    "twitter",
    "x.com",
    "instagram",
    "reddit",
    "tiktok",
    "netflix",
    "twitch",
    "facebook",
    "bilibili",
    "weibo",
    "douyin",
    "xiaohongshu",
    "zhihu",
    "douban",
    "taobao",
    "jd.com",
    "小红书",
    "微博",
    "抖音",
    "知乎",
    "豆瓣",
    "淘宝",
    "京东",
    "哔哩哔哩",
    "虎扑",
    "贴吧"
  ]
};

export function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createEmptyStats(date = todayKey()): TodayStats {
  return {
    date,
    breaksTaken: 0,
    breakPromptsShown: 0,
    watersLogged: 0,
    focusMinutes: 0,
    focusWarnings: 0
  };
}
