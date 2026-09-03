import { useMemo, useState } from "react";
import { useStore } from "../lib/storeContext";
import { Card, SecondaryButton } from "./ui";
import { PeriodPicker } from "./PeriodPicker";
import { formatMoney, formatShort, todayISO } from "../lib/dates";
import { rangeForPreset, type Preset } from "../lib/period";
import { downloadCSV, toCSV } from "../lib/csv";
import { JOB_TYPE_LABELS, PAYMENT_METHOD_LABELS, type JobType, type PaymentMethod } from "../types";

export function IncomeReport() {
  const { jobs, customers } = useStore();
  const [preset, setPreset] = useState<Preset>("2weeks");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());

  const [start, end] = rangeForPreset(preset, customStart, customEnd);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const paidJobs = useMemo(
    () =>
      jobs
        .filter((j) => j.paid && j.paidDate && j.paidDate >= start && j.paidDate <= end)
        .sort((a, b) => (b.paidDate ?? "").localeCompare(a.paidDate ?? "")),
    [jobs, start, end],
  );

  const total = paidJobs.reduce((s, j) => s + j.amount, 0);

  const byMethod = useMemo(() => {
    const map = new Map<PaymentMethod, { count: number; total: number }>();
    for (const job of paidJobs) {
      const method = job.paymentMethod ?? "other";
      const entry = map.get(method) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += job.amount;
      map.set(method, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [paidJobs]);

  const byType = useMemo(() => {
    const map = new Map<JobType, { count: number; total: number }>();
    for (const job of paidJobs) {
      const entry = map.get(job.type) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += job.amount;
      map.set(job.type, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [paidJobs]);

  return (
    <div className="space-y-4">
      <PeriodPicker
        preset={preset}
        onPresetChange={setPreset}
        customStart={customStart}
        onCustomStartChange={setCustomStart}
        customEnd={customEnd}
        onCustomEndChange={setCustomEnd}
      />

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-bark-600">
              Collected {preset !== "all" ? `${formatShort(start)} – ${formatShort(end)}` : "all time"}
            </p>
            <p className="text-3xl font-semibold text-moss-900 mt-1">{formatMoney(total)}</p>
            <p className="text-xs text-bark-600 mt-0.5">
              {paidJobs.length} payment{paidJobs.length === 1 ? "" : "s"}
            </p>
          </div>
          {paidJobs.length > 0 && (
            <SecondaryButton
              className="shrink-0"
              onClick={() => {
                const rows = paidJobs.map((j) => ({
                  paidDate: j.paidDate ?? "",
                  customer: customerById.get(j.customerId)?.name ?? "Unknown",
                  type: JOB_TYPE_LABELS[j.type],
                  amount: j.amount,
                  method: j.paymentMethod ? PAYMENT_METHOD_LABELS[j.paymentMethod] : "",
                  scheduledDate: j.date,
                }));
                const csv = toCSV(rows, [
                  { key: "paidDate", label: "Paid Date" },
                  { key: "customer", label: "Customer" },
                  { key: "type", label: "Job Type" },
                  { key: "amount", label: "Amount" },
                  { key: "method", label: "Payment Method" },
                  { key: "scheduledDate", label: "Scheduled Date" },
                ]);
                downloadCSV(`yardbook-income-${start}-to-${end}.csv`, csv);
              }}
            >
              Export .csv
            </SecondaryButton>
          )}
        </div>
      </Card>

      {byMethod.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-semibold text-moss-900 mb-3">By payment method</p>
          <div className="space-y-2.5">
            {byMethod.map(([method, { count, total: methodTotal }]) => (
              <div key={method}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-moss-900">
                    {PAYMENT_METHOD_LABELS[method]} <span className="text-bark-600 font-normal">({count})</span>
                  </span>
                  <span className="font-semibold text-moss-900">{formatMoney(methodTotal)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-bark-100 overflow-hidden">
                  <div
                    className="h-full bg-moss-500 rounded-full"
                    style={{ width: `${total > 0 ? (methodTotal / total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {byType.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-semibold text-moss-900 mb-3">By job type</p>
          <div className="space-y-1.5">
            {byType.map(([type, { count, total: typeTotal }]) => (
              <div key={type} className="flex items-center justify-between text-sm">
                <span className="text-bark-600">
                  {JOB_TYPE_LABELS[type]} <span className="text-bark-600/70">({count})</span>
                </span>
                <span className="font-medium text-moss-900">{formatMoney(typeTotal)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {paidJobs.length > 0 ? (
        <Card className="divide-y divide-bark-100">
          {paidJobs.map((job) => {
            const customer = customerById.get(job.customerId);
            return (
              <div key={job.id} className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-moss-900 truncate">{customer?.name ?? "Unknown customer"}</p>
                  <p className="text-sm text-bark-600 truncate">
                    {formatShort(job.paidDate!)} · {JOB_TYPE_LABELS[job.type]}
                    {job.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[job.paymentMethod]}` : ""}
                  </p>
                </div>
                <span className="font-semibold text-moss-900 shrink-0">{formatMoney(job.amount)}</span>
              </div>
            );
          })}
        </Card>
      ) : (
        <p className="text-center text-sm text-bark-600 py-8">No payments recorded in this period.</p>
      )}
    </div>
  );
}
