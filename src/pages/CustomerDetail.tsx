import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Badge, Card, PrimaryButton, SecondaryButton } from "../components/ui";
import { ContactButtons } from "../components/ContactButtons";
import { buildReminderMessage } from "../lib/contact";
import { formatFriendly, formatMoney, todayISO } from "../lib/dates";
import { FREQUENCY_LABELS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "../types";
import { CheckIcon, ChevronLeftIcon, PlusIcon, SkipIcon } from "../components/icons";

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { customers, jobs, settings, addJob, markJobDone, markJobPaid, updateJob, deleteJob } = useStore();
  const [showAddJob, setShowAddJob] = useState(false);
  const [payingJobId, setPayingJobId] = useState<string | null>(null);

  const customer = customers.find((c) => c.id === id);
  const customerJobs = useMemo(
    () => jobs.filter((j) => j.customerId === id).sort((a, b) => b.date.localeCompare(a.date)),
    [jobs, id],
  );

  if (!customer) {
    return (
      <div className="p-8 text-center text-bark-600">
        Customer not found. <Link to="/customers" className="text-moss-700 font-medium">Back to customers</Link>
      </div>
    );
  }

  const unpaid = customerJobs.filter((j) => j.status === "done" && !j.paid);
  const balance = unpaid.reduce((sum, j) => sum + j.amount, 0);
  const upcoming = customerJobs
    .filter((j) => j.status === "scheduled" && j.date >= todayISO())
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = customerJobs.filter((j) => j.status !== "scheduled" || j.date < todayISO());

  const reminderMsg =
    unpaid.length > 0
      ? buildReminderMessage(customer, settings, {
          amount: balance,
          jobCount: unpaid.length,
          oldestDate: unpaid[unpaid.length - 1].date,
        })
      : "";

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pb-10">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-bark-600 mb-4 -ml-1">
        <ChevronLeftIcon className="h-4 w-4" /> Back
      </button>

      <div className="flex items-start gap-3 mb-5">
        <div className="h-14 w-14 rounded-full bg-moss-100 text-moss-700 flex items-center justify-center text-xl font-semibold shrink-0">
          {customer.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold text-moss-900">{customer.name}</h1>
            {customer.isContract && <Badge tone="moss">Contract</Badge>}
            {!customer.active && <Badge>Inactive</Badge>}
          </div>
          <p className="text-sm text-bark-600">
            {FREQUENCY_LABELS[customer.frequency]} · {formatMoney(customer.rate)}/visit
          </p>
          {customer.address && <p className="text-sm text-bark-600">{customer.address}</p>}
        </div>
        <Link to={`/customers/${customer.id}/edit`}>
          <SecondaryButton type="button">Edit</SecondaryButton>
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-5">
        <ContactButtons
          customer={customer}
          smsBody={reminderMsg}
          mailSubject={`Lawn service balance — ${formatMoney(balance)}`}
          mailBody={reminderMsg}
        />
      </div>

      {balance > 0 && (
        <Card className="p-4 mb-5 border-rust-500/30 bg-rust-500/5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-bark-600">Balance due</p>
              <p className="text-2xl font-semibold text-rust-600">{formatMoney(balance)}</p>
              <p className="text-xs text-bark-600 mt-0.5">
                {unpaid.length} unpaid visit{unpaid.length > 1 ? "s" : ""}
              </p>
            </div>
            <SecondaryButton onClick={() => setPayingJobId(unpaid[0].id)}>Mark paid</SecondaryButton>
          </div>
        </Card>
      )}

      {customer.notes && (
        <Card className="p-4 mb-5">
          <p className="text-xs font-medium text-bark-600 mb-1">Notes</p>
          <p className="text-sm text-moss-900 whitespace-pre-wrap">{customer.notes}</p>
        </Card>
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-moss-900">Upcoming</h2>
        <button
          onClick={() => setShowAddJob((v) => !v)}
          className="flex items-center gap-1 text-sm text-moss-700 font-medium"
        >
          <PlusIcon className="h-3.5 w-3.5" /> Add visit
        </button>
      </div>

      {showAddJob && (
        <AddJobRow
          defaultAmount={customer.rate}
          onAdd={(date, amount) => {
            addJob({ customerId: customer.id, date, amount, status: "scheduled", paid: false, notes: "" });
            setShowAddJob(false);
          }}
          onCancel={() => setShowAddJob(false)}
        />
      )}

      {upcoming.length === 0 && !showAddJob ? (
        <Card className="p-4 text-sm text-bark-600 text-center mb-5">No upcoming visits scheduled.</Card>
      ) : (
        <Card className="divide-y divide-bark-100 mb-5">
          {upcoming.map((job) => (
            <div key={job.id} className="flex items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-moss-900">{formatFriendly(job.date)}</p>
                <p className="text-sm text-bark-600">{formatMoney(job.amount)}</p>
              </div>
              <button
                onClick={() => updateJob(job.id, { status: "skipped" })}
                className="rounded-full bg-bark-100 text-bark-600 p-2 hover:bg-bark-100/70 transition"
                aria-label="Skip"
              >
                <SkipIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => markJobDone(job.id)}
                className="rounded-full bg-moss-700 text-white p-2 hover:bg-moss-800 transition"
                aria-label="Mark done"
              >
                <CheckIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </Card>
      )}

      <h2 className="font-semibold text-moss-900 mb-2">History</h2>
      {past.length === 0 ? (
        <Card className="p-4 text-sm text-bark-600 text-center">No visits logged yet.</Card>
      ) : (
        <Card className="divide-y divide-bark-100">
          {past.map((job) => (
            <div key={job.id} className="flex items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-moss-900">{formatFriendly(job.date)}</p>
                <p className="text-sm text-bark-600">
                  {formatMoney(job.amount)}
                  {job.status === "skipped" && " · Skipped"}
                  {job.paid && job.paymentMethod && ` · Paid via ${PAYMENT_METHOD_LABELS[job.paymentMethod]}`}
                </p>
              </div>
              {job.status === "done" ? (
                job.paid ? (
                  <Badge tone="moss">Paid</Badge>
                ) : (
                  <button
                    onClick={() => setPayingJobId(job.id)}
                    className="text-xs font-semibold rounded-full bg-rust-500 text-white px-3 py-1.5"
                  >
                    Mark paid
                  </button>
                )
              ) : job.status === "skipped" ? (
                <Badge>Skipped</Badge>
              ) : null}
              <button
                onClick={() => deleteJob(job.id)}
                className="text-xs text-bark-600/60 hover:text-rust-500 px-1"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </Card>
      )}

      {payingJobId && (
        <PaymentModal
          onClose={() => setPayingJobId(null)}
          onConfirm={(method) => {
            markJobPaid(payingJobId, method);
            setPayingJobId(null);
          }}
        />
      )}
    </div>
  );
}

function AddJobRow({
  defaultAmount,
  onAdd,
  onCancel,
}: {
  defaultAmount: number;
  onAdd: (date: string, amount: number) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(defaultAmount);
  return (
    <Card className="p-4 mb-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-bark-600 mb-1">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-bark-100 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-bark-600 mb-1">Amount</span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full rounded-xl border border-bark-100 px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <PrimaryButton className="flex-1" onClick={() => onAdd(date, amount)}>
          Add
        </PrimaryButton>
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
      </div>
    </Card>
  );
}

function PaymentModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (method: PaymentMethod) => void;
}) {
  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-5 safe-bottom">
        <h3 className="font-semibold text-moss-900 mb-4">How did they pay?</h3>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method) => (
            <button
              key={method}
              onClick={() => onConfirm(method)}
              className="rounded-xl bg-bark-50 border border-bark-100 py-3 text-sm font-medium hover:bg-moss-100 hover:border-moss-200 transition"
            >
              {PAYMENT_METHOD_LABELS[method]}
            </button>
          ))}
        </div>
        <SecondaryButton onClick={onClose} className="w-full">
          Cancel
        </SecondaryButton>
      </div>
    </div>
  );
}
