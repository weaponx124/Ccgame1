import { createContext, useContext } from "react";
import type { Customer, Expense, Job, Settings } from "../types";

export type Role = "owner" | "crew";

export interface StoreValue {
  role: Role;
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

export const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
