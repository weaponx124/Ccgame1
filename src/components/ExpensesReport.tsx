import { useMemo, useState } from "react";
import { useStore } from "../lib/storeContext";
import { Card, Badge, SecondaryButton, PrimaryButton, EmptyState } from "./ui";
import { PeriodPicker } from "./PeriodPicker";
import { ExpenseForm } from "./ExpenseForm";
import { formatMoney, formatShort, todayISO } from "../lib/dates";
import { rangeForPreset, type Preset } from "../lib/period";
import { downloadCSV, toCSV } from "../lib/csv";
import { EXPENSE_CATEGORY_LABELS, type Expense, type ExpenseCategory } from "../types";
import { EditIcon, PlusIcon, ReceiptIcon } from "./icons";

export function ExpensesReport() {
  const { expenses, jobs, customers, addExpense, updateExpense, deleteExpense } = useStore();
  const [preset, setPreset] = useState<Preset>("2weeks");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const [start, end] = rangeForPreset(preset, customStart, customEnd);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  const periodExpenses = useMemo(
    () =>
      expenses
        .filter((e) => e.date >= start && e.date <= end)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [expenses, start, end],
  );

  const total = periodExpenses.reduce((s, e) => s + e.amount, 0);

  const incomeTotal = useMemo(
    () =>
      jobs
        .filter((j) => j.paid && j.paidDate && j.paidDate >= start && j.paidDate <= end)
        .reduce((s, j) => s + j.amount, 0),
    [jobs, start, end],
  );

  const byCategory = useMemo(() => {
    const map = new Map<ExpenseCategory, { count: number; total: number }>();
    for (const e of periodExpenses) {
      const entry = map.get(e.category) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += e.amount;
      map.set(e.category, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [periodExpenses]);

  function exportCSV() {
    const rows = periodExpenses.map((e) => ({
      date: e.date,
      category: EXPENSE_CATEGORY_LABELS[e.category],
      description: e.description,
      amount: e.amount,
      billable: e.billable ? "Yes" : "No",
      customer: e.customerId ? customerById.get(e.customerId)?.name ?? "" : "",
      billAmount: e.billable ? e.billAmount ?? e.amount : "",
    }));
    const csv = toCSV(rows, [
      { key: "date", label: "Date" },
      { key: "category", label: "Category" },
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount" },
      { key: "billable", label: "Billable" },
      { key: "customer", label: "Customer" },
      { key: "billAmount", label: "Billed Amount" },
    ]);
    downloadCSV(`yardbook-expenses-${start}-to-${end}.csv`, csv);
  }

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
              Spent {preset !== "all" ? `${formatShort(start)} – ${formatShort(end)}` : "all time"}
            </p>
            <p className="text-3xl font-semibold text-rust-600 mt-1">{formatMoney(total)}</p>
            <p className="text-xs text-bark-600 mt-0.5">
              {periodExpenses.length} expense{periodExpenses.length === 1 ? "" : "s"}
            </p>
          </div>
          <PrimaryButton className="shrink-0" onClick={() => setShowForm(true)}>
            <PlusIcon className="h-4 w-4" /> Add
          </PrimaryButton>
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold text-moss-900 mb-2">Income vs. expenses</p>
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-bark-600">Collected</span>
          <span className="font-medium text-moss-700">{formatMoney(incomeTotal)}</span>
        </div>
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-bark-600">Spent</span>
          <span className="font-medium text-rust-600">-{formatMoney(total)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-bark-100 pt-2">
          <span className="text-sm font-semibold text-moss-900">Net</span>
          <span className={`text-lg font-semibold ${incomeTotal - total >= 0 ? "text-moss-700" : "text-rust-600"}`}>
            {formatMoney(incomeTotal - total)}
          </span>
        </div>
      </Card>

      {byCategory.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-semibold text-moss-900 mb-3">By category</p>
          <div className="space-y-2.5">
            {byCategory.map(([category, { count, total: catTotal }]) => (
              <div key={category}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-moss-900">
                    {EXPENSE_CATEGORY_LABELS[category]} <span className="text-bark-600 font-normal">({count})</span>
                  </span>
                  <span className="font-semibold text-moss-900">{formatMoney(catTotal)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-bark-100 overflow-hidden">
                  <div
                    className="h-full bg-rust-500 rounded-full"
                    style={{ width: `${total > 0 ? (catTotal / total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {periodExpenses.length > 0 ? (
        <>
          <div className="flex justify-end">
            <SecondaryButton onClick={exportCSV}>Export .csv</SecondaryButton>
          </div>
          <Card className="divide-y divide-bark-100">
            {periodExpenses.map((e) => {
              const linkedJob = e.linkedJobId ? jobById.get(e.linkedJobId) : undefined;
              return (
                <div key={e.id} className="flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-moss-900 truncate">
                      {e.description || EXPENSE_CATEGORY_LABELS[e.category]}
                    </p>
                    <p className="text-sm text-bark-600 truncate">
                      {formatShort(e.date)} · {EXPENSE_CATEGORY_LABELS[e.category]}
                      {e.billable && customerById.get(e.customerId ?? "")
                        ? ` · billed to ${customerById.get(e.customerId ?? "")?.name}`
                        : ""}
                    </p>
                  </div>
                  {e.billable && (
                    <Badge tone={linkedJob?.paid ? "moss" : "clay"}>
                      {linkedJob?.paid ? "Collected" : "To collect"}
                    </Badge>
                  )}
                  <span className="font-semibold text-rust-600 shrink-0">{formatMoney(e.amount)}</span>
                  <button
                    onClick={() => setEditingExpense(e)}
                    className="rounded-full bg-bark-100 text-bark-600 p-2 hover:bg-bark-100/70 transition shrink-0"
                    aria-label="Edit expense"
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </Card>
        </>
      ) : (
        <EmptyState
          icon={<ReceiptIcon className="h-12 w-12" />}
          title="No expenses logged"
          body="Track fuel, equipment, and materials here — mark anything you need to collect from a customer as billable."
          action={
            <PrimaryButton onClick={() => setShowForm(true)}>
              <PlusIcon className="h-4 w-4" /> Add an expense
            </PrimaryButton>
          }
        />
      )}

      {showForm && (
        <ExpenseForm
          onClose={() => setShowForm(false)}
          onSave={(input) => {
            addExpense(input);
            setShowForm(false);
          }}
        />
      )}

      {editingExpense && (
        <ExpenseForm
          expense={editingExpense}
          onClose={() => setEditingExpense(null)}
          onSave={(input) => {
            updateExpense(editingExpense.id, input);
            setEditingExpense(null);
          }}
          onDelete={() => {
            deleteExpense(editingExpense.id);
            setEditingExpense(null);
          }}
        />
      )}
    </div>
  );
}
