import { useState } from "react";
import { useStore } from "../lib/store";
import { Card, PrimaryButton } from "../components/ui";

export default function Settings() {
  const { settings, updateSettings, customers, jobs } = useStore();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    updateSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ customers, jobs, settings }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yardbook-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 md:p-8 max-w-lg mx-auto space-y-6 pb-10">
      <h1 className="text-2xl font-semibold text-moss-900">Settings</h1>

      <form onSubmit={save} className="space-y-4">
        <Section title="Business">
          <Field label="Business name">
            <input value={form.businessName} onChange={(e) => set("businessName", e.target.value)} className={inputCls} placeholder="e.g. Mendoza Bros Landscaping" />
          </Field>
          <Field label="Your name">
            <input value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Your phone">
            <input value={form.ownerPhone} onChange={(e) => set("ownerPhone", e.target.value)} className={inputCls} />
          </Field>
        </Section>

        <Section title="Payment methods (shown in reminders)">
          <Field label="Venmo username">
            <input value={form.venmo} onChange={(e) => set("venmo", e.target.value)} className={inputCls} placeholder="@yourname" />
          </Field>
          <Field label="Zelle">
            <input value={form.zelle} onChange={(e) => set("zelle", e.target.value)} className={inputCls} placeholder="phone or email" />
          </Field>
          <Field label="Cash App">
            <input value={form.cashapp} onChange={(e) => set("cashapp", e.target.value)} className={inputCls} placeholder="$yourname" />
          </Field>
        </Section>

        <Section title="Reminder message">
          <p className="text-xs text-bark-600 mb-2">
            Use {"{customer}"}, {"{business}"}, {"{date}"}, and {"{amount}"} — they'll be filled in automatically.
          </p>
          <textarea
            value={form.reminderTemplate}
            onChange={(e) => set("reminderTemplate", e.target.value)}
            className={`${inputCls} min-h-28`}
          />
        </Section>

        <PrimaryButton type="submit" className="w-full">
          {saved ? "Saved ✓" : "Save settings"}
        </PrimaryButton>
      </form>

      <Section title="Your data">
        <p className="text-sm text-bark-600 mb-3">
          Everything is stored privately on this device. Download a backup now and then in case you switch phones.
        </p>
        <button
          onClick={exportData}
          className="text-sm font-medium text-moss-700 underline underline-offset-2"
        >
          Download backup (.json)
        </button>
      </Section>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-bark-100 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-moss-500/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3 last:mb-0">
      <span className="block text-xs font-medium text-bark-600 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-moss-900 mb-3">{title}</h2>
      {children}
    </Card>
  );
}
