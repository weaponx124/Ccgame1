import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useStore } from "../lib/storeContext";
import { totalOwed } from "../lib/contact";
import { formatFriendly, formatMoney, todayISO } from "../lib/dates";
import { Card, EmptyState, PrimaryButton, Badge } from "../components/ui";
import { ContactButtons } from "../components/ContactButtons";
import { JobEditModal } from "../components/JobEditModal";
import { CalendarIcon, CashIcon, CheckIcon, EditIcon, PlusIcon, UsersIcon } from "../components/icons";
import { JOB_TYPE_LABELS, type Job } from "../types";

export default function Dashboard() {
  const { customers, jobs, markJobDone, updateJob, deleteJob, role } = useStore();
  const isOwner = role === "owner";
  const today = todayISO();
  const [editingJob, setEditingJob] = useState<Job | null>(null);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const todaysJobs = jobs
    .filter((j) => j.date === today && j.status === "scheduled")
    .sort((a, b) => a.date.localeCompare(b.date));

  const weekJobs = jobs.filter((j) => {
    if (j.status !== "scheduled") return false;
    const diff = (new Date(j.date).getTime() - new Date(today).getTime()) / 86400000;
    return diff > 0 && diff <= 7;
  });

  const owed = totalOwed(jobs);
  const unpaidJobs = jobs.filter((j) => j.status === "done" && !j.paid);
  const unpaidCustomers = new Set(unpaidJobs.map((j) => j.customerId)).size;

  if (customers.length === 0) {
    return (
      <div className="max-w-lg mx-auto">
        <EmptyState
          icon={<UsersIcon className="h-12 w-12" />}
          title="Welcome to YardBook"
          body={
            isOwner
              ? "Add your first customer to start building your schedule and tracking payments."
              : "No customers yet — check back once the schedule is set up."
          }
          action={
            isOwner ? (
              <Link to="/customers/new">
                <PrimaryButton>
                  <PlusIcon className="h-4 w-4" /> Add your first customer
                </PrimaryButton>
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-moss-900">
          {greeting()}
          {"."}
        </h1>
        <p className="text-bark-600 text-sm mt-0.5">
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className={`grid gap-3 ${isOwner ? "grid-cols-3" : "grid-cols-2"}`}>
        <StatCard icon={<CalendarIcon className="h-5 w-5" />} label="Today" value={String(todaysJobs.length)} />
        <StatCard icon={<CheckIcon className="h-5 w-5" />} label="This week" value={String(weekJobs.length)} />
        {isOwner && (
          <Link to="/collections">
            <StatCard
              icon={<CashIcon className="h-5 w-5" />}
              label="Owed"
              value={formatMoney(owed)}
              tone={owed > 0 ? "rust" : "moss"}
            />
          </Link>
        )}
      </div>

      {isOwner && unpaidCustomers > 0 && (
        <Link to="/collections">
          <Card className="p-4 flex items-center gap-3 border-rust-500/30 bg-rust-500/5">
            <div className="h-10 w-10 rounded-full bg-rust-500/15 text-rust-600 flex items-center justify-center shrink-0">
              <CashIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-moss-900">
                {unpaidCustomers} {unpaidCustomers === 1 ? "customer owes" : "customers owe"} you {formatMoney(owed)}
              </p>
              <p className="text-sm text-bark-600">Tap to review &amp; send reminders</p>
            </div>
          </Card>
        </Link>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-moss-900">Today's jobs</h2>
          <Link to="/schedule" className="text-sm text-moss-700 font-medium">
            See schedule
          </Link>
        </div>
        {todaysJobs.length === 0 ? (
          <Card className="p-6 text-center text-sm text-bark-600">Nothing scheduled today. Enjoy it.</Card>
        ) : (
          <div className="space-y-2">
            {todaysJobs.map((job) => {
              const customer = customerById.get(job.customerId);
              if (!customer) return null;
              return (
                <Card key={job.id} className="p-3.5 flex items-center gap-3">
                  <Link to={`/customers/${customer.id}`} className="min-w-0 flex-1">
                    <p className="font-medium text-moss-900 truncate">{customer.name}</p>
                    <p className="text-sm text-bark-600 truncate">
                      {customer.address || "No address"} · {formatMoney(job.amount)}
                    </p>
                    <Badge>{JOB_TYPE_LABELS[job.type]}</Badge>
                  </Link>
                  <ContactButtons customer={customer} size="sm" />
                  {isOwner && (
                    <button
                      onClick={() => setEditingJob(job)}
                      className="rounded-full bg-bark-100 text-bark-600 p-2.5 hover:bg-bark-100/70 transition shrink-0"
                      aria-label="Edit visit"
                    >
                      <EditIcon className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => markJobDone(job.id)}
                    className="rounded-full bg-moss-700 text-white p-2.5 hover:bg-moss-800 transition shrink-0"
                    aria-label="Mark done"
                  >
                    <CheckIcon className="h-4 w-4" />
                  </button>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {weekJobs.length > 0 && (
        <section>
          <h2 className="font-semibold text-moss-900 mb-2">Coming up this week</h2>
          <Card className="divide-y divide-bark-100">
            {weekJobs
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 8)
              .map((job) => {
                const customer = customerById.get(job.customerId);
                if (!customer) return null;
                return (
                  <div key={job.id} className="flex items-center gap-3 p-3.5 first:rounded-t-2xl last:rounded-b-2xl">
                    <Link to={`/customers/${customer.id}`} className="min-w-0 flex-1">
                      <p className="font-medium text-moss-900 truncate">{customer.name}</p>
                      <p className="text-sm text-bark-600 truncate">
                        {JOB_TYPE_LABELS[job.type]} · {formatMoney(job.amount)}
                      </p>
                    </Link>
                    <Badge>{formatFriendly(job.date)}</Badge>
                    {isOwner && (
                      <button
                        onClick={() => setEditingJob(job)}
                        className="rounded-full bg-bark-100 text-bark-600 p-2 hover:bg-bark-100/70 transition shrink-0"
                        aria-label="Edit visit"
                      >
                        <EditIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
          </Card>
        </section>
      )}

      {editingJob && (
        <JobEditModal
          job={editingJob}
          onClose={() => setEditingJob(null)}
          onSave={(patch) => {
            updateJob(editingJob.id, patch);
            setEditingJob(null);
          }}
          onDelete={() => {
            deleteJob(editingJob.id);
            setEditingJob(null);
          }}
        />
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}

function StatCard({
  icon,
  label,
  value,
  tone = "moss",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "moss" | "rust";
}) {
  return (
    <Card className="p-3.5">
      <div
        className={`h-8 w-8 rounded-lg flex items-center justify-center mb-2 ${
          tone === "rust" ? "bg-rust-500/15 text-rust-600" : "bg-moss-100 text-moss-700"
        }`}
      >
        {icon}
      </div>
      <p className="text-lg font-semibold text-moss-900 leading-tight">{value}</p>
      <p className="text-xs text-bark-600">{label}</p>
    </Card>
  );
}
