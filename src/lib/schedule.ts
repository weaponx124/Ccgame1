import type { Customer, Job } from "../types";
import { makeId } from "./id";
import { addDays, fromISODate, toISODate, todayISO } from "./dates";

const FREQUENCY_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 28,
};

/**
 * Generates the next occurrences for recurring customers so the schedule
 * always has jobs filled in `weeksAhead` weeks out, without duplicating
 * a date that customer already has a job on.
 */
export function generateUpcomingJobs(customers: Customer[], jobs: Job[], weeksAhead = 6): Job[] {
  const horizon = addDays(fromISODate(todayISO()), weeksAhead * 7);
  const newJobs: Job[] = [];

  for (const customer of customers) {
    if (!customer.active) continue;
    const step = FREQUENCY_DAYS[customer.frequency];
    if (!step) continue; // one-time customers are scheduled manually

    const existingDates = new Set(
      jobs.filter((j) => j.customerId === customer.id).map((j) => j.date),
    );

    let cursor = nextDateForWeekday(new Date(), customer.serviceDay);
    // Walk backward slightly so we don't skip a "this week" slot if the
    // customer was created after their usual day already passed.
    while (step && toISODate(cursor) <= toISODate(horizon)) {
      const iso = toISODate(cursor);
      if (!existingDates.has(iso)) {
        newJobs.push({
          id: makeId(),
          customerId: customer.id,
          date: iso,
          type: "mowing",
          status: "scheduled",
          amount: customer.rate,
          paid: false,
          notes: "",
        });
        existingDates.add(iso);
      }
      cursor = addDays(cursor, step);
    }
  }

  return newJobs;
}

function nextDateForWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const diff = (weekday - d.getDay() + 7) % 7;
  return addDays(d, diff);
}
