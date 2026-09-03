import { addDays, fromISODate, startOfWeek, toISODate, todayISO } from "./dates";

export type Preset = "today" | "week" | "2weeks" | "month" | "all" | "custom";

export const PERIOD_PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "2weeks", label: "2 weeks" },
  { id: "month", label: "This month" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

export function rangeForPreset(preset: Preset, customStart: string, customEnd: string): [string, string] {
  const today = todayISO();
  const now = fromISODate(today);
  switch (preset) {
    case "today":
      return [today, today];
    case "week": {
      const start = startOfWeek(now);
      return [toISODate(start), toISODate(addDays(start, 6))];
    }
    case "2weeks":
      return [toISODate(addDays(now, -13)), today];
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return [toISODate(start), toISODate(end)];
    }
    case "all":
      return ["0000-01-01", "9999-12-31"];
    case "custom":
      return [customStart || today, customEnd || today];
  }
}
