import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import type { AppData, Customer, Expense, Job } from "../types";
import { db } from "./firebase";
import { defaultSettings, normalizeData } from "./storage";
import { generateUpcomingJobs } from "./schedule";
import { makeId } from "./id";
import { StoreContext, type Role, type StoreValue } from "./storeContext";

/** Strips `id` and drops undefined-valued keys — safe to hand straight to setDoc. */
function forCreate<T extends { id: string }>(obj: T): Record<string, unknown> {
  const { id: _id, ...rest } = obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** For updateDoc/batch.update — an explicit `undefined` means "clear this field", not "error". */
function forUpdate<T extends object>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === undefined ? deleteField() : v;
  }
  return out;
}

export function CloudStoreProvider({ role, children }: { role: Role; children: ReactNode }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settings, setSettings] = useState(defaultSettings);

  useEffect(() => {
    if (!db) return;
    const unsubCustomers = onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map((d) => ({ ...(d.data() as Omit<Customer, "id">), id: d.id })));
    });
    const unsubJobs = onSnapshot(collection(db, "jobs"), (snap) => {
      setJobs(snap.docs.map((d) => ({ ...(d.data() as Omit<Job, "id">), id: d.id })));
    });
    return () => {
      unsubCustomers();
      unsubJobs();
    };
  }, []);

  // Expenses and settings are owner-only per the security rules — don't even try to
  // subscribe as crew, that would just log permission-denied noise for nothing.
  useEffect(() => {
    if (!db || role !== "owner") {
      setExpenses([]);
      setSettings(defaultSettings);
      return;
    }
    const unsubExpenses = onSnapshot(collection(db, "expenses"), (snap) => {
      setExpenses(snap.docs.map((d) => ({ ...(d.data() as Omit<Expense, "id">), id: d.id })));
    });
    const unsubSettings = onSnapshot(doc(db, "settings", "main"), (snap) => {
      setSettings(snap.exists() ? { ...defaultSettings, ...snap.data() } : defaultSettings);
    });
    return () => {
      unsubExpenses();
      unsubSettings();
    };
  }, [role]);

  // Keep the recurring schedule topped up — owner only; crew can't create jobs per the rules anyway.
  useEffect(() => {
    const database = db;
    if (!database || role !== "owner" || customers.length === 0) return;
    const fresh = generateUpcomingJobs(customers, jobs, 6);
    if (fresh.length === 0) return;
    const batch = writeBatch(database);
    fresh.forEach((j) => batch.set(doc(database, "jobs", j.id), forCreate(j)));
    void batch.commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, role]);

  const value = useMemo<StoreValue>(
    () => ({
      role,
      customers,
      jobs,
      expenses,
      settings,

      addCustomer(c) {
        const customer: Customer = { ...c, id: makeId(), createdAt: new Date().toISOString() };
        if (db) void setDoc(doc(db, "customers", customer.id), forCreate(customer));
        return customer;
      },

      updateCustomer(id, patch) {
        if (db) void setDoc(doc(db, "customers", id), forUpdate(patch), { merge: true });
      },

      deleteCustomer(id) {
        const database = db;
        if (!database) return;
        void deleteDoc(doc(database, "customers", id));
        jobs.filter((j) => j.customerId === id).forEach((j) => void deleteDoc(doc(database, "jobs", j.id)));
      },

      addJob(j) {
        const job: Job = { ...j, id: makeId() };
        if (db) void setDoc(doc(db, "jobs", job.id), forCreate(job));
        return job;
      },

      updateJob(id, patch) {
        if (db) void setDoc(doc(db, "jobs", id), forUpdate(patch), { merge: true });
      },

      deleteJob(id) {
        if (db) void deleteDoc(doc(db, "jobs", id));
      },

      markJobDone(id) {
        if (!db) return;
        const job = jobs.find((j) => j.id === id);
        void setDoc(
          doc(db, "jobs", id),
          { status: "done", completedDate: job?.completedDate ?? new Date().toISOString().slice(0, 10) },
          { merge: true },
        );
      },

      markJobPaid(id, method) {
        if (!db) return;
        const job = jobs.find((j) => j.id === id);
        void setDoc(
          doc(db, "jobs", id),
          {
            paid: true,
            paidDate: new Date().toISOString().slice(0, 10),
            paymentMethod: method ?? job?.paymentMethod ?? null,
          },
          { merge: true },
        );
      },

      updateSettings(patch) {
        if (db) void setDoc(doc(db, "settings", "main"), forUpdate(patch), { merge: true });
      },

      refreshSchedule(weeksAhead = 6) {
        const fresh = generateUpcomingJobs(customers, jobs, weeksAhead);
        const database = db;
        if (database && fresh.length > 0) {
          const batch = writeBatch(database);
          fresh.forEach((j) => batch.set(doc(database, "jobs", j.id), forCreate(j)));
          void batch.commit();
        }
        return fresh.length;
      },

      importData(raw) {
        const normalized = normalizeData(raw);
        if (db) void replaceAllCloudData(db, normalized);
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
        if (db) {
          const batch = writeBatch(db);
          batch.set(doc(db, "expenses", expense.id), forCreate(expense));
          if (job) batch.set(doc(db, "jobs", job.id), forCreate(job));
          void batch.commit();
        }
        return expense;
      },

      updateExpense(id, patch) {
        if (!db) return;
        const expense = expenses.find((e) => e.id === id);
        if (!expense) return;
        const updated = { ...expense, ...patch };
        const batch = writeBatch(db);
        batch.update(doc(db, "expenses", id), forUpdate(patch));
        if (updated.linkedJobId) {
          const linkedJob = jobs.find((j) => j.id === updated.linkedJobId);
          if (linkedJob && !linkedJob.paid) {
            batch.update(doc(db, "jobs", updated.linkedJobId), {
              date: updated.date,
              amount: updated.billAmount ?? updated.amount,
              notes: updated.description,
            });
          }
        }
        void batch.commit();
      },

      deleteExpense(id) {
        if (!db) return;
        const expense = expenses.find((e) => e.id === id);
        const batch = writeBatch(db);
        batch.delete(doc(db, "expenses", id));
        if (expense?.linkedJobId) {
          const linkedJob = jobs.find((j) => j.id === expense.linkedJobId);
          if (linkedJob && !linkedJob.paid) {
            batch.delete(doc(db, "jobs", expense.linkedJobId));
          }
        }
        void batch.commit();
      },
    }),
    [role, customers, jobs, expenses, settings],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/** Wholesale replace of customers/jobs/expenses/settings — used for "restore from backup" and the one-time local→cloud migration. */
async function replaceAllCloudData(db: Firestore, data: AppData) {
  for (const col of ["customers", "jobs", "expenses"] as const) {
    const snap = await getDocs(collection(db, col));
    const ids = snap.docs.map((d) => d.id);
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      ids.slice(i, i + 400).forEach((id) => batch.delete(doc(db, col, id)));
      await batch.commit();
    }
  }
  const collections: [string, { id: string }[]][] = [
    ["customers", data.customers],
    ["jobs", data.jobs],
    ["expenses", data.expenses],
  ];
  for (const [col, items] of collections) {
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db);
      items.slice(i, i + 400).forEach((item) => batch.set(doc(db, col, item.id), forCreate(item)));
      await batch.commit();
    }
  }
  await setDoc(doc(db, "settings", "main"), data.settings);
}
