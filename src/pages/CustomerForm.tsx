import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import type { Customer, Frequency } from "../types";
import { FREQUENCY_LABELS, WEEKDAY_LABELS } from "../types";
import { PrimaryButton, SecondaryButton } from "../components/ui";
import { ChevronLeftIcon, TrashIcon } from "../components/icons";

const empty = {
  name: "",
  phone: "",
  email: "",
  address: "",
  frequency: "weekly" as Frequency,
  serviceDay: 1,
  rate: 45,
  notes: "",
  isContract: false,
  active: true,
};

export default function CustomerForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { customers, addCustomer, updateCustomer, deleteCustomer } = useStore();
  const existing = id ? customers.find((c) => c.id === id) : undefined;

  const [form, setForm] = useState(existing ?? empty);

  useEffect(() => {
    if (existing) setForm(existing);
  }, [existing]);

  const isEdit = Boolean(existing);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (isEdit && existing) {
      updateCustomer(existing.id, form);
      navigate(`/customers/${existing.id}`);
    } else {
      const created = addCustomer(form as Omit<Customer, "id" | "createdAt">);
      navigate(`/customers/${created.id}`);
    }
  }

  function handleDelete() {
    if (!existing) return;
    if (confirm(`Delete ${existing.name}? This also removes their job history.`)) {
      deleteCustomer(existing.id);
      navigate("/customers");
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-lg mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-bark-600 mb-4 -ml-1"
      >
        <ChevronLeftIcon className="h-4 w-4" /> Back
      </button>
      <h1 className="text-2xl font-semibold text-moss-900 mb-5">
        {isEdit ? "Edit customer" : "New customer"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name">
          <input
            required
            autoFocus
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className={inputCls}
            placeholder="Jane Smith"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              className={inputCls}
              placeholder="(555) 123-4567"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className={inputCls}
              placeholder="optional"
            />
          </Field>
        </div>

        <Field label="Address">
          <input
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            className={inputCls}
            placeholder="123 Maple St"
          />
        </Field>

        <label className="flex items-center gap-2.5 rounded-xl bg-white border border-bark-100 px-3.5 py-3">
          <input
            type="checkbox"
            checked={form.isContract}
            onChange={(e) => set("isContract", e.target.checked)}
            className="h-4 w-4 accent-moss-700"
          />
          <span className="text-sm font-medium">This is a commercial contract, not a residential customer</span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Frequency">
            <select
              value={form.frequency}
              onChange={(e) => set("frequency", e.target.value as Frequency)}
              className={inputCls}
            >
              {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rate per visit">
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-bark-600">$</span>
              <input
                type="number"
                min={0}
                step={1}
                value={form.rate}
                onChange={(e) => set("rate", Number(e.target.value))}
                className={`${inputCls} pl-7`}
              />
            </div>
          </Field>
        </div>

        {form.frequency !== "one-time" && (
          <Field label="Preferred service day">
            <select
              value={form.serviceDay}
              onChange={(e) => set("serviceDay", Number(e.target.value))}
              className={inputCls}
            >
              {WEEKDAY_LABELS.map((label, idx) => (
                <option key={idx} value={idx}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            className={`${inputCls} min-h-20`}
            placeholder="Gate code, dog in yard, mowing preferences…"
          />
        </Field>

        <label className="flex items-center gap-2.5 rounded-xl bg-white border border-bark-100 px-3.5 py-3">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
            className="h-4 w-4 accent-moss-700"
          />
          <span className="text-sm font-medium">Active (include in auto-scheduling)</span>
        </label>

        <div className="flex gap-3 pt-2">
          <PrimaryButton type="submit" className="flex-1">
            {isEdit ? "Save changes" : "Add customer"}
          </PrimaryButton>
        </div>

        {isEdit && (
          <SecondaryButton type="button" onClick={handleDelete} className="w-full text-rust-600">
            <TrashIcon className="h-4 w-4" /> Delete customer
          </SecondaryButton>
        )}
      </form>
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
