export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  return addDays(copy, -day);
}

export function isSameISODay(a: string, b: string): boolean {
  return a === b;
}

export function daysBetween(fromISO: string, toISOStr: string): number {
  const a = fromISODate(fromISO);
  const b = fromISODate(toISOStr);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function formatFriendly(iso: string): string {
  const d = fromISODate(iso);
  const today = todayISO();
  const diff = daysBetween(today, iso);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function formatShort(iso: string): string {
  const d = fromISODate(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
