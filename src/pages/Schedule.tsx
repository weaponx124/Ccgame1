import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/storeContext";
import { addDays, fromISODate, toISODate, todayISO } from "../lib/dates";
import { formatMoney } from "../lib/dates";
import { Badge, Card, EmptyState, SecondaryButton } from "../components/ui";
import { ContactButtons } from "../components/ContactButtons";
import { JobEditModal } from "../components/JobEditModal";
import { CalendarIcon, CheckIcon, ChevronLeftIcon, EditIcon, SkipIcon } from "../components/icons";
import { JOB_TYPE_LABELS, type Job } from "../types";

export default function Schedule() {
  const { customers, jobs, markJobDone, updateJob, deleteJob, refreshSchedule, role } = useStore();
  const isOwner = role === "owner";
  const [weekOffset, setWeekOffset] = useState(0);
  const [justGenerated, setJustGenerated] = useState<number | null>(null);
  const [editingJob, setEditingJob] = useState<Job | null>(null);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const weekStart = useMemo(() => {
    const d = fromISODate(todayISO());
    const day = d.getDay();
    return addDays(d, -day + weekOffset * 7);
  }, [weekOffset]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const jobsByDay = useMemo(() => {
    const map = new Map<string, typeof jobs>();
    for (const day of days) {
      const iso = toISODate(day);
      map.set(
        iso,
        jobs
          .filter((j) => j.date === iso && j.status !== "skipped")
          .sort((a, b) => a.customerId.localeCompare(b.customerId)),
      );
    }
    return map;
  }, [jobs, days]);

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(
    weekStart,
    6,
  ).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  if (customers.length === 0) {
    return (
      <div className="max-w-lg mx-auto">
        <EmptyState icon={<CalendarIcon className="h-12 w-12" />} title="No schedule yet" body="Add customers to build your route." />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-moss-900">Schedule</h1>
        {isOwner && (
          <SecondaryButton
            onClick={() => {
              const n = refreshSchedule(8);
              setJustGenerated(n);
              setTimeout(() => setJustGenerated(null), 3000);
            }}
          >
            Refresh
          </SecondaryButton>
        )}
      </div>
      {justGenerated !== null && (
        <p className="text-sm text-moss-700">
          {justGenerated > 0 ? `Added ${justGenerated} upcoming visit${justGenerated > 1 ? "s" : ""}.` : "Schedule is already up to date."}
        </p>
      )}
      {isOwner && <p className="text-xs text-bark-600 -mt-2">Tap the pencil on any visit to move it to a different day.</p>}

      <div className="flex items-center justify-between">
        <button
          onClick={() => setWeekOffset((w) => w - 1)}
          className="rounded-full bg-white border border-bark-100 p-2"
          aria-label="Previous week"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="font-medium text-moss-900">{weekLabel}</p>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="text-xs text-moss-700 font-medium">
              Back to this week
            </button>
          )}
        </div>
        <button
          onClick={() => setWeekOffset((w) => w + 1)}
          className="rounded-full bg-white border border-bark-100 p-2 rotate-180"
          aria-label="Next week"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        {days.map((day) => {
          const iso = toISODate(day);
          const dayJobs = jobsByDay.get(iso) ?? [];
          const isToday = iso === todayISO();
          return (
            <div key={iso}>
              <div className="flex items-center gap-2 mb-1.5">
                <p className={`text-sm font-semibold ${isToday ? "text-moss-700" : "text-bark-600"}`}>
                  {day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                </p>
                {isToday && <span className="text-[10px] font-bold bg-moss-700 text-white rounded-full px-2 py-0.5">TODAY</span>}
              </div>
              {dayJobs.length === 0 ? (
                <p className="text-sm text-bark-600/60 pl-0.5">No jobs</p>
              ) : (
                <Card className="divide-y divide-bark-100">
                  {dayJobs.map((job) => {
                    const customer = customerById.get(job.customerId);
                    if (!customer) return null;
                    return (
                      <div key={job.id} className="flex items-center gap-3 p-3.5">
                        <Link to={`/customers/${customer.id}`} className="min-w-0 flex-1">
                          <p className="font-medium text-moss-900 truncate">{customer.name}</p>
                          <p className="text-sm text-bark-600 truncate">
                            {customer.address || "No address"} · {formatMoney(job.amount)}
                          </p>
                          <Badge>{JOB_TYPE_LABELS[job.type]}</Badge>
                        </Link>
                        {job.status === "scheduled" ? (
                          <>
                            <ContactButtons customer={customer} size="sm" />
                            {isOwner && (
                              <button
                                onClick={() => setEditingJob(job)}
                                className="rounded-full bg-bark-100 text-bark-600 p-2 hover:bg-bark-100/70 transition shrink-0"
                                aria-label="Edit visit"
                              >
                                <EditIcon className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => updateJob(job.id, { status: "skipped" })}
                              className="rounded-full bg-bark-100 text-bark-600 p-2 hover:bg-bark-100/70 transition shrink-0"
                              aria-label="Skip"
                            >
                              <SkipIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => markJobDone(job.id)}
                              className="rounded-full bg-moss-700 text-white p-2 hover:bg-moss-800 transition shrink-0"
                              aria-label="Mark done"
                            >
                              <CheckIcon className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-xs font-semibold text-moss-700 bg-moss-100 rounded-full px-2.5 py-1 shrink-0">
                              Done
                            </span>
                            {isOwner && (
                              <button
                                onClick={() => setEditingJob(job)}
                                className="rounded-full bg-bark-100 text-bark-600 p-2 hover:bg-bark-100/70 transition shrink-0"
                                aria-label="Edit visit"
                              >
                                <EditIcon className="h-4 w-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </Card>
              )}
            </div>
          );
        })}
      </div>

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
