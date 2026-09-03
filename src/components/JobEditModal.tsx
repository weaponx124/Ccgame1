import { useState } from "react";
import type { Job, JobType, PaymentMethod } from "../types";
import { JOB_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "../types";
import { PrimaryButton, SecondaryButton } from "./ui";
import { TrashIcon } from "./icons";

export function JobEditModal({
  job,
  onSave,
  onDelete,
  onClose,
}: {
  job: Job;
  onSave: (patch: Partial<Job>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(job.date);
  const [type, setType] = useState<JobType>(job.type);
  const [amount, setAmount] = useState(job.amount);
  const [completedDate, setCompletedDate] = useState(job.completedDate ?? job.date);
  const [paidDate, setPaidDate] = useState(job.paidDate ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(job.paymentMethod ?? "");

  function save() {
    const patch: Partial<Job> = { date, type, amount };
    if (job.status === "done") patch.completedDate = completedDate;
    if (job.paid) {
      patch.paidDate = paidDate;
      if (paymentMethod) patch.paymentMethod = paymentMethod;
    }
    onSave(patch);
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-5 safe-bottom space-y-3.5 max-h-[85dvh] overflow-y-auto">
        <h3 className="font-semibold text-moss-900">Edit visit</h3>

        <Field label="Scheduled date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>

        <Field label="Job type">
          <select value={type} onChange={(e) => setType(e.target.value as JobType)} className={inputCls}>
            {Object.entries(JOB_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Amount">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-bark-600">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className={`${inputCls} pl-7`}
            />
          </div>
        </Field>

        {job.status === "done" && (
          <Field label="Actually completed on">
            <input
              type="date"
              value={completedDate}
              onChange={(e) => setCompletedDate(e.target.value)}
              className={inputCls}
            />
          </Field>
        )}

        {job.paid && (
          <>
            <Field label="Paid on">
              <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Paid via">
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className={inputCls}
              >
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <div className="flex gap-2 pt-1">
          <PrimaryButton className="flex-1" onClick={save}>
            Save
          </PrimaryButton>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        </div>
        <button
          onClick={onDelete}
          className="flex items-center justify-center gap-1.5 text-sm text-rust-600 font-medium w-full py-1"
        >
          <TrashIcon className="h-4 w-4" /> Delete visit
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-bark-100 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-moss-500/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-bark-600 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
