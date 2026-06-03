import { createEmptyStats, todayKey } from "../shared/constants";
import type { StatsHistory, TodayStats } from "../shared/types";

export type StatsStore = {
  get(key: "stats", defaultValue: TodayStats): TodayStats;
  get(key: "statsHistory", defaultValue: StatsHistory): StatsHistory;
  set(key: "stats", value: TodayStats): void;
  set(key: "statsHistory", value: StatsHistory): void;
};

export function getStatsHistory(store: StatsStore): StatsHistory {
  const history = store.get("statsHistory", {});
  return Object.fromEntries(
    Object.entries(history).map(([date, stats]) => [date, normalizeStats(stats, date)])
  );
}

function normalizeStats(stats: Partial<TodayStats> | undefined, fallbackDate = todayKey()): TodayStats {
  const date = stats?.date || fallbackDate;
  return {
    ...createEmptyStats(date),
    ...stats,
    date,
    breaksTaken: stats?.breaksTaken ?? 0,
    breakPromptsShown: stats?.breakPromptsShown ?? stats?.breaksTaken ?? 0,
    watersLogged: stats?.watersLogged ?? 0,
    focusMinutes: stats?.focusMinutes ?? 0,
    focusWarnings: stats?.focusWarnings ?? 0
  };
}

export function isSameStats(left: TodayStats | undefined, right: TodayStats): boolean {
  const normalizedLeft = left ? normalizeStats(left, right.date) : undefined;
  const normalizedRight = normalizeStats(right);
  return Boolean(
    normalizedLeft &&
      normalizedLeft.date === normalizedRight.date &&
      normalizedLeft.breaksTaken === normalizedRight.breaksTaken &&
      normalizedLeft.breakPromptsShown === normalizedRight.breakPromptsShown &&
      normalizedLeft.watersLogged === normalizedRight.watersLogged &&
      normalizedLeft.focusMinutes === normalizedRight.focusMinutes &&
      normalizedLeft.focusWarnings === normalizedRight.focusWarnings
  );
}

export function saveStatsToHistory(store: StatsStore, stats: TodayStats): void {
  const normalized = normalizeStats(stats);
  if (!normalized.date) return;
  const history = getStatsHistory(store);
  if (isSameStats(history[normalized.date], normalized)) return;
  store.set("statsHistory", {
    ...history,
    [normalized.date]: normalized
  });
}

export function getCurrentStats(store: StatsStore, date = todayKey()): TodayStats {
  const stats = normalizeStats(store.get("stats", createEmptyStats()), date);
  if (stats.date !== date) {
    saveStatsToHistory(store, stats);
    const current = getStatsHistory(store)[date] ?? createEmptyStats(date);
    store.set("stats", current);
    saveStatsToHistory(store, current);
    return current;
  }

  saveStatsToHistory(store, stats);
  return stats;
}

export function updateCurrentStats(
  store: StatsStore,
  mutator: (stats: TodayStats) => TodayStats
): TodayStats {
  const next = mutator(getCurrentStats(store));
  store.set("stats", next);
  saveStatsToHistory(store, next);
  return next;
}

export function resetCurrentStats(store: StatsStore, date = todayKey()): TodayStats {
  const reset = createEmptyStats(date);
  store.set("stats", reset);
  saveStatsToHistory(store, reset);
  return reset;
}
