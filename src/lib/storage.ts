import type { AppData } from "../types";

const KEY = "yardbook:data:v1";

const defaultSettings: AppData["settings"] = {
  businessName: "",
  ownerName: "",
  ownerPhone: "",
  venmo: "",
  zelle: "",
  cashapp: "",
  reminderTemplate:
    "Hi {customer}, this is {business}. Just a friendly reminder that your lawn service on {date} (${amount}) is still open. Thanks so much — let me know if you have any questions!",
};

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: 1, customers: [], jobs: [], settings: defaultSettings };
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      customers: parsed.customers ?? [],
      jobs: parsed.jobs ?? [],
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return { version: 1, customers: [], jobs: [], settings: defaultSettings };
  }
}

export function saveData(data: AppData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable — fail silently, data stays in memory
  }
}
