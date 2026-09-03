import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppData, Customer, Expense, Job, Settings } from "../types";
import { loadData, normalizeData, saveData } from "./storage";
import { generateUpcomingJobs } from "./schedule";
import { makeId } from "./id";

interface StoreValue {
  customers: Customer[];
  jobs: Job[];
  expenses: Expense[];
  settings: Settings;
  addCustomer: (c: Omit<Customer, "id" | "createdAt">) => Customer;
  updateCustomer: (id: string, patch: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  addJob: (j: Omit<Job, "id">) => Job;
  updateJob: (id: string, patch: Partial<Job>) => void;
  deleteJob: (id: string) => void;
  markJobDone: (id: string) => void;
  markJobPaid: (id: string, method?: Job["paymentMethod"]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  refreshSchedule: (weeksAhead?: number) => number;
  importData: (raw: unknown) => { customers: number; jobs: number };
  addExpense: (input: Omit<Expense, "id" | "linkedJobId">) => Expense;
  updateExpense: (id: string, patch: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => loadData());

  useEffect(() => {
    saveData(data);
  }, [data]);

  // Keep the recurring schedule topped up whenever customers change.
  useEffect(() => {
    setData((prev) => {
      const fresh = generateUpcomingJobs(prev.customers, prev.jobs, 6);
      if (fresh.length === 0) return prev;
      return { ...prev, jobs: [...prev.jobs, ...fresh] };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      customers: data.customers,
      jobs: data.jobs,
      expenses: data.expenses,
      settings: data.settings,

      addCustomer(c) {
        const customer: Customer = { ...c, id: makeId(), createdAt: new Date().toISOString() };
        setData((prev) => {
          const customers = [...prev.customers, customer];
          const fresh = generateUpcomingJobs(customers, prev.jobs, 6);
          return { ...prev, customers, jobs: [...prev.jobs, ...fresh] };
        });
        return customer;
      },

      updateCustomer(id, patch) {
        setData((prev) => {
          const customers = prev.customers.map((c) => (c.id === id ? { ...c, ...patch } : c));
          const fresh = generateUpcomingJobs(customers, prev.jobs, 6);
          return { ...prev, customers, jobs: [...prev.jobs, ...fresh] };
        });
      },

      deleteCustomer(id) {
        setData((prev) => ({
          ...prev,
          customers: prev.customers.filter((c) => c.id !== id),
          jobs: prev.jobs.filter((j) => j.customerId !== id),
        }));
      },

      addJob(j) {
        const job: Job = { ...j, id: makeId() };
        setData((prev) => ({ ...prev, jobs: [...prev.jobs, job] }));
        return job;
      },

      updateJob(id, patch) {
        setData((prev) => ({
          ...prev,
          jobs: prev.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
        }));
      },

      deleteJob(id) {
        setData((prev) => ({ ...prev, jobs: prev.jobs.filter((j) => j.id !== id) }));
      },

      markJobDone(id) {
        setData((prev) => ({
          ...prev,
          jobs: prev.jobs.map((j) =>
            j.id === id ? { ...j, status: "done", completedDate: j.completedDate ?? new Date().toISOString().slice(0, 10) } : j,
          ),
        }));
      },

      markJobPaid(id, method) {
        setData((prev) => ({
          ...prev,
          jobs: prev.jobs.map((j) =>
            j.id === id
              ? {
                  ...j,
                  paid: true,
                  paidDate: new Date().toISOString().slice(0, 10),
                  paymentMethod: method ?? j.paymentMethod,
                }
              : j,
          ),
        }));
      },

      updateSettings(patch) {
        setData((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
      },

      refreshSchedule(weeksAhead = 6) {
        const fresh = generateUpcomingJobs(data.customers, data.jobs, weeksAhead);
        if (fresh.length > 0) {
          setData((prev) => ({ ...prev, jobs: [...prev.jobs, ...fresh] }));
        }
        return fresh.length;
      },

      importData(raw) {
        const normalized = normalizeData(raw);
        setData(normalized);
        return { customers: normalized.customers.length, jobs: normalized.jobs.length };
      },

      addExpense(input) {
        const expense: Expense = { ...input, id: makeId() };
        let job: Job | undefined;
        if (expense.billable && expense.customerId) {
          job = {
            id: makeId(),
            customerId: expense.customerId,
            date: expense.date,
            type: "materials",
            status: "done",
            completedDate: expense.date,
            amount: expense.billAmount ?? expense.amount,
            paid: false,
            notes: expense.description,
          };
          expense.linkedJobId = job.id;
        }
        const finalJob = job;
        setData((prev) => ({
          ...prev,
          expenses: [...prev.expenses, expense],
          jobs: finalJob ? [...prev.jobs, finalJob] : prev.jobs,
        }));
        return expense;
      },

      updateExpense(id, patch) {
        setData((prev) => {
          const expense = prev.expenses.find((e) => e.id === id);
          if (!expense) return prev;
          const updated = { ...expense, ...patch };
          const jobs = updated.linkedJobId
            ? prev.jobs.map((j) =>
                j.id === updated.linkedJobId && !j.paid
                  ? {
                      ...j,
                      date: updated.date,
                      amount: updated.billAmount ?? updated.amount,
                      notes: updated.description,
                    }
                  : j,
              )
            : prev.jobs;
          return {
            ...prev,
            jobs,
            expenses: prev.expenses.map((e) => (e.id === id ? updated : e)),
          };
        });
      },

      deleteExpense(id) {
        setData((prev) => {
          const expense = prev.expenses.find((e) => e.id === id);
          const jobs = expense?.linkedJobId
            ? prev.jobs.filter((j) => !(j.id === expense.linkedJobId && !j.paid))
            : prev.jobs;
          return {
            ...prev,
            jobs,
            expenses: prev.expenses.filter((e) => e.id !== id),
          };
        });
      },
    }),
    [data],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
