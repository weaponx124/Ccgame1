import { useState } from "react";
import { useStore } from "../lib/storeContext";
import { PrimaryButton, SecondaryButton } from "./ui";
import { TrashIcon } from "./icons";
import { todayISO } from "../lib/dates";
import { EXPENSE_CATEGORY_LABELS, type Expense, type ExpenseCategory } from "../types";

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

export function ExpenseForm({
  expense,
  onSave,
  onDelete,
  onClose,
}: {
  expense?: Expense;
  onSave: (input: Omit<Expense, "id" | "linkedJobId">) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { customers } = useStore();
  const [date, setDate] = useState(expense?.date ?? todayISO());
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? "materials");
  const [amount, setAmount] = useState(expense?.amount ?? 0);
  const [description, setDescription] = useState(expense?.description ?? "");
  const [billable, setBillable] = useState(expense?.billable ?? false);
  const [customerId, setCustomerId] = useState(expense?.customerId ?? "");
  const [billAmount, setBillAmount] = useState(expense?.billAmount ?? expense?.amount ?? 0);

  const alreadyLinked = Boolean(expense?.linkedJobId);

  function save() {
    onSave({
      date,
      category,
      amount,
      description,
      billable,
      customerId: billable ? customerId || undefined : undefined,
      billAmount: billable ? billAmount || amount : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-5 safe-bottom space-y-3.5 max-h-[85dvh] overflow-y-auto">
        <h3 className="font-semibold text-moss-900">{expense ? "Edit expense" : "Add expense"}</h3>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Amount you paid">
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
        </div>

        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className={inputCls}>
            {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
            placeholder="e.g. mower blades, gas, mulch for Smith yard"
          />
        </Field>

        <label className="flex items-center gap-2.5 rounded-xl bg-bark-50 border border-bark-100 px-3.5 py-3">
          <input
            type="checkbox"
            checked={billable}
            disabled={alreadyLinked}
            onChange={(e) => setBillable(e.target.checked)}
            className="h-4 w-4 accent-moss-700"
          />
          <span className="text-sm font-medium">
            Bill this to a customer <span className="text-bark-600 font-normal">(materials you'll collect on)</span>
          </span>
        </label>

        {billable && (
          <>
            <Field label="Customer">
              <select
                value={customerId}
                disabled={alreadyLinked}
                onChange={(e) => setCustomerId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select a customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount to charge them">
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-bark-600">$</span>
                <input
                  type="number"
                  value={billAmount}
                  onChange={(e) => setBillAmount(Number(e.target.value))}
                  className={`${inputCls} pl-7`}
                />
              </div>
            </Field>
            {alreadyLinked && (
              <p className="text-xs text-bark-600">
                This charge is already on the customer's balance — only the amounts stay in sync here, not who it's
                billed to.
              </p>
            )}
          </>
        )}

        <div className="flex gap-2 pt-1">
          <PrimaryButton className="flex-1" onClick={save} disabled={billable && !customerId}>
            Save
          </PrimaryButton>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="flex items-center justify-center gap-1.5 text-sm text-rust-600 font-medium w-full py-1"
          >
            <TrashIcon className="h-4 w-4" /> Delete expense
          </button>
        )}
      </div>
    </div>
  );
}
