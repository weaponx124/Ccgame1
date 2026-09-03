import type { Customer, Job, Settings } from "../types";
import { formatShort } from "./dates";

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function smsHref(phone: string, body: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  // iOS uses &body=, most Android clients accept it too via ?; both work with `&`.
  return `sms:${digits}?&body=${encodeURIComponent(body)}`;
}

export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function buildReminderMessage(
  customer: Customer,
  settings: Settings,
  opts: { amount: number; jobCount: number; oldestDate: string },
): string {
  const payWays = [
    settings.venmo && `Venmo @${settings.venmo.replace(/^@/, "")}`,
    settings.zelle && `Zelle ${settings.zelle}`,
    settings.cashapp && `Cash App $${settings.cashapp.replace(/^\$/, "")}`,
  ].filter(Boolean);

  const business = settings.businessName || settings.ownerName || "your lawn care service";
  const amountLabel = opts.jobCount > 1 ? `$${opts.amount} (${opts.jobCount} visits)` : `$${opts.amount}`;

  let msg = settings.reminderTemplate
    .replaceAll("{customer}", customer.name.split(" ")[0] || customer.name)
    .replaceAll("{business}", business)
    .replaceAll("{date}", formatShort(opts.oldestDate))
    .replaceAll("{amount}", String(opts.amount));

  if (opts.jobCount > 1) {
    msg = msg.replace(`$${opts.amount}`, amountLabel);
  }

  if (payWays.length > 0) {
    msg += ` You can pay via ${payWays.join(" or ")}.`;
  }

  return msg;
}

export function totalOwed(jobs: Job[]): number {
  return jobs.filter((j) => j.status === "done" && !j.paid).reduce((sum, j) => sum + j.amount, 0);
}
