import { useRef, useState } from "react";
import { useStore } from "../lib/store";
import { Card, PrimaryButton } from "../components/ui";
import { downloadCSV, toCSV } from "../lib/csv";
import { todayISO } from "../lib/dates";
import { FREQUENCY_LABELS, JOB_TYPE_LABELS, PAYMENT_METHOD_LABELS, WEEKDAY_LABELS } from "../types";

export default function Settings() {
  const { settings, updateSettings, customers, jobs, importData } = useStore();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    updateSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ customers, jobs, settings }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yardbook-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        const custCount = Array.isArray(raw?.customers) ? raw.customers.length : 0;
        const jobCount = Array.isArray(raw?.jobs) ? raw.jobs.length : 0;
        const ok = window.confirm(
          `This backup has ${custCount} customer${custCount === 1 ? "" : "s"} and ${jobCount} visit${
            jobCount === 1 ? "" : "s"
          }.\n\nRestoring will REPLACE everything currently on this device. Only do this when setting up a new phone. Continue?`,
        );
        if (!ok) return;
        const result = importData(raw);
        setImportMsg(`Restored ${result.customers} customers and ${result.jobs} visits.`);
        setTimeout(() => setImportMsg(null), 5000);
      } catch {
        window.alert("That doesn't look like a valid YardBook backup file (.json).");
      }
    };
    reader.readAsText(file);
  }

  function exportJobsCSV() {
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const rows = jobs
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((j) => ({
        date: j.date,
        customer: customerById.get(j.customerId)?.name ?? "Unknown",
        type: JOB_TYPE_LABELS[j.type],
        status: j.status,
        amount: j.amount,
        completedDate: j.completedDate ?? "",
        paid: j.paid ? "Yes" : "No",
        paidDate: j.paidDate ?? "",
        paymentMethod: j.paymentMethod ? PAYMENT_METHOD_LABELS[j.paymentMethod] : "",
        notes: j.notes,
      }));
    const csv = toCSV(rows, [
      { key: "date", label: "Scheduled Date" },
      { key: "customer", label: "Customer" },
      { key: "type", label: "Job Type" },
      { key: "status", label: "Status" },
      { key: "amount", label: "Amount" },
      { key: "completedDate", label: "Completed Date" },
      { key: "paid", label: "Paid" },
      { key: "paidDate", label: "Paid Date" },
      { key: "paymentMethod", label: "Payment Method" },
      { key: "notes", label: "Notes" },
    ]);
    downloadCSV(`yardbook-visits-${todayISO()}.csv`, csv);
  }

  function exportCustomersCSV() {
    const rows = customers.map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      frequency: FREQUENCY_LABELS[c.frequency],
      serviceDay: WEEKDAY_LABELS[c.serviceDay],
      rate: c.rate,
      contract: c.isContract ? "Yes" : "No",
      active: c.active ? "Yes" : "No",
      notes: c.notes,
    }));
    const csv = toCSV(rows, [
      { key: "name", label: "Name" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "address", label: "Address" },
      { key: "frequency", label: "Frequency" },
      { key: "serviceDay", label: "Service Day" },
      { key: "rate", label: "Rate" },
      { key: "contract", label: "Contract" },
      { key: "active", label: "Active" },
      { key: "notes", label: "Notes" },
    ]);
    downloadCSV(`yardbook-customers-${todayISO()}.csv`, csv);
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

      <Section title="Backup & restore">
        <p className="text-sm text-bark-600 mb-3">
          Everything is stored privately on this device only — if the phone is lost, the data goes with it unless
          you've backed it up. Download a backup every so often (right after entering new customers is a good habit),
          and keep a copy on your computer. If you get a new phone, open YardBook there and restore from that file.
        </p>
        <div className="flex flex-col items-start gap-2">
          <button onClick={exportBackup} className="text-sm font-medium text-moss-700 underline underline-offset-2">
            Download backup (.json)
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-sm font-medium text-moss-700 underline underline-offset-2"
          >
            Restore from backup (.json)
          </button>
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} />
          {importMsg && <p className="text-sm text-moss-700 font-medium">{importMsg}</p>}
        </div>
      </Section>

      <Section title="Export for Excel / taxes">
        <p className="text-sm text-bark-600 mb-3">
          Spreadsheet files that open directly in Excel, Numbers, or Google Sheets.
        </p>
        <div className="flex flex-col items-start gap-2">
          <button onClick={exportJobsCSV} className="text-sm font-medium text-moss-700 underline underline-offset-2">
            Export all visits (.csv)
          </button>
          <button onClick={exportCustomersCSV} className="text-sm font-medium text-moss-700 underline underline-offset-2">
            Export customer list (.csv)
          </button>
        </div>
        <p className="text-xs text-bark-600 mt-3">
          For a specific tax period (e.g. a quarter), use Collect → Income instead — it exports only the paid visits
          in the date range you pick.
        </p>
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
