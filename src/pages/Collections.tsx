import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { buildReminderMessage, totalOwed } from "../lib/contact";
import { daysBetween, formatMoney, formatShort, todayISO } from "../lib/dates";
import { Badge, Card, EmptyState, SecondaryButton } from "../components/ui";
import { ContactButtons } from "../components/ContactButtons";
import { IncomeReport } from "../components/IncomeReport";
import { ExpensesReport } from "../components/ExpensesReport";
import { CashIcon, CheckIcon } from "../components/icons";
import { JOB_TYPE_LABELS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "../types";

type Tab = "owed" | "income" | "expenses";

export default function Collections() {
  const { customers, jobs, settings, markJobPaid } = useStore();
  const [tab, setTab] = useState<Tab>("owed");
  const [payingCustomerId, setPayingCustomerId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byCustomer = new Map<string, typeof jobs>();
    for (const job of jobs) {
      if (job.status === "done" && !job.paid) {
        const list = byCustomer.get(job.customerId) ?? [];
        list.push(job);
        byCustomer.set(job.customerId, list);
      }
    }
    const result = [];
    for (const [customerId, jobList] of byCustomer) {
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) continue;
      jobList.sort((a, b) => a.date.localeCompare(b.date));
      const total = jobList.reduce((s, j) => s + j.amount, 0);
      const oldest = jobList[0].date;
      result.push({ customer, jobs: jobList, total, oldest });
    }
    result.sort((a, b) => a.oldest.localeCompare(b.oldest));
    return result;
  }, [jobs, customers]);

  const owed = totalOwed(jobs);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-moss-900">Money</h1>
        {tab === "owed" && (
          <p className="text-bark-600 text-sm mt-0.5">
            {formatMoney(owed)} outstanding across {groups.length} customer{groups.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("owed")}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
            tab === "owed" ? "bg-moss-700 text-white" : "bg-bark-100 text-bark-600"
          }`}
        >
          Owed{owed > 0 ? ` · ${formatMoney(owed)}` : ""}
        </button>
        <button
          onClick={() => setTab("income")}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
            tab === "income" ? "bg-moss-700 text-white" : "bg-bark-100 text-bark-600"
          }`}
        >
          Income
        </button>
        <button
          onClick={() => setTab("expenses")}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
            tab === "expenses" ? "bg-moss-700 text-white" : "bg-bark-100 text-bark-600"
          }`}
        >
          Expenses
        </button>
      </div>

      {tab === "owed" ? (
        groups.length === 0 ? (
          <EmptyState
            icon={<CashIcon className="h-12 w-12" />}
            title="All caught up"
            body="Nobody owes you money right now. Nice."
          />
        ) : (
          <div className="space-y-3">
            {groups.map(({ customer, jobs: jobList, total, oldest }) => {
              const daysOverdue = daysBetween(oldest, todayISO());
              const msg = buildReminderMessage(customer, settings, {
                amount: total,
                jobCount: jobList.length,
                oldestDate: oldest,
              });
              return (
                <Card key={customer.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <Link to={`/customers/${customer.id}`} className="min-w-0 flex-1">
                      <p className="font-medium text-moss-900">{customer.name}</p>
                      <p className="text-sm text-bark-600">
                        {jobList.length} unpaid visit{jobList.length > 1 ? "s" : ""} · since {formatShort(oldest)}
                      </p>
                    </Link>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-rust-600">{formatMoney(total)}</p>
                      {daysOverdue >= 14 ? (
                        <Badge tone="rust">{daysOverdue}d</Badge>
                      ) : daysOverdue >= 7 ? (
                        <Badge tone="clay">{daysOverdue}d</Badge>
                      ) : daysOverdue >= 0 ? (
                        <Badge>{daysOverdue}d</Badge>
                      ) : (
                        <Badge>New</Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 space-y-1">
                    {jobList.map((job) => (
                      <div key={job.id} className="flex items-center justify-between text-xs text-bark-600">
                        <span>
                          {formatShort(job.date)} · {JOB_TYPE_LABELS[job.type]}
                        </span>
                        <span>{formatMoney(job.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <ContactButtons
                      customer={customer}
                      smsBody={msg}
                      mailSubject={`Lawn service balance — ${formatMoney(total)}`}
                      mailBody={msg}
                    />
                    <SecondaryButton className="ml-auto" onClick={() => setPayingCustomerId(customer.id)}>
                      <CheckIcon className="h-4 w-4" /> Mark paid
                    </SecondaryButton>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : tab === "income" ? (
        <IncomeReport />
      ) : (
        <ExpensesReport />
      )}

      {payingCustomerId && (
        <PaymentModal
          onClose={() => setPayingCustomerId(null)}
          onConfirm={(method) => {
            const group = groups.find((g) => g.customer.id === payingCustomerId);
            group?.jobs.forEach((j) => markJobPaid(j.id, method));
            setPayingCustomerId(null);
          }}
        />
      )}
    </div>
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
        <h3 className="font-semibold text-moss-900 mb-1">Mark all as paid</h3>
        <p className="text-sm text-bark-600 mb-4">How did they pay?</p>
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
