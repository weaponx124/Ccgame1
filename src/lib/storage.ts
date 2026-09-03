import type { AppData, Job } from "../types";

const KEY = "yardbook:data:v1";

export const defaultSettings: AppData["settings"] = {
  businessName: "",
  ownerName: "",
  ownerPhone: "",
  venmo: "",
  zelle: "",
  cashapp: "",
  reminderTemplate:
    "Hi {customer}, this is {business}. Just a friendly reminder that your lawn service on {date} (${amount}) is still open. Thanks so much — let me know if you have any questions!",
};

/** Coerces arbitrary parsed JSON (a fresh load, or an imported backup file) into a valid AppData shape. */
export function normalizeData(raw: unknown): AppData {
  const parsed = (raw ?? {}) as Partial<AppData> & Record<string, unknown>;
  const jobs: Job[] = (Array.isArray(parsed.jobs) ? (parsed.jobs as Job[]) : []).map((j) => ({
    ...j,
    type: j.type ?? "mowing",
  }));
  return {
    version: 1,
    customers: Array.isArray(parsed.customers) ? parsed.customers : [],
    jobs,
    expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
    settings: { ...defaultSettings, ...((parsed.settings as Partial<AppData["settings"]>) ?? {}) },
  };
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return normalizeData(null);
    return normalizeData(JSON.parse(raw));
  } catch {
    return normalizeData(null);
  }
}

export function saveData(data: AppData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable — fail silently, data stays in memory
  }
}
