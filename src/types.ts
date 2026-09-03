export type Frequency = "weekly" | "biweekly" | "monthly" | "one-time";

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  "one-time": "One-time",
};

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  frequency: Frequency;
  serviceDay: number; // 0=Sun..6=Sat
  rate: number; // dollars per visit
  notes: string;
  isContract: boolean;
  active: boolean;
  createdAt: string;
}

export type JobStatus = "scheduled" | "done" | "skipped";

export type JobType = "mowing" | "shrub-trim" | "fertilizer" | "cleanup" | "materials" | "other";

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  mowing: "Mowing",
  "shrub-trim": "Shrub trim",
  fertilizer: "Fertilizer",
  cleanup: "Cleanup",
  materials: "Materials",
  other: "Other",
};

export type PaymentMethod = "cash" | "check" | "venmo" | "zelle" | "cashapp" | "card" | "other";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  zelle: "Zelle",
  cashapp: "Cash App",
  card: "Card",
  other: "Other",
};

export interface Job {
  id: string;
  customerId: string;
  date: string; // ISO yyyy-mm-dd — scheduled date
  type: JobType;
  status: JobStatus;
  amount: number;
  completedDate?: string; // ISO — actual date the work was done, may differ from `date`
  paid: boolean;
  paidDate?: string;
  paymentMethod?: PaymentMethod;
  notes: string;
}

export type ExpenseCategory = "fuel" | "equipment" | "materials" | "maintenance" | "insurance" | "other";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fuel: "Fuel",
  equipment: "Equipment",
  materials: "Materials",
  maintenance: "Maintenance & repairs",
  insurance: "Insurance",
  other: "Other",
};

export interface Expense {
  id: string;
  date: string; // ISO yyyy-mm-dd
  category: ExpenseCategory;
  amount: number; // what you paid out of pocket
  description: string;
  /** True when this cost should be passed on to a customer instead of eaten as overhead. */
  billable: boolean;
  customerId?: string;
  /** What to charge the customer, if billable — defaults to `amount` when unset (no markup). */
  billAmount?: number;
  /** The auto-created Job (type "materials") that carries this charge through the normal collect/paid flow. */
  linkedJobId?: string;
}

export interface Settings {
  businessName: string;
  ownerName: string;
  ownerPhone: string;
  venmo: string;
  zelle: string;
  cashapp: string;
  reminderTemplate: string;
}

export interface AppData {
  version: 1;
  customers: Customer[];
  jobs: Job[];
  expenses: Expense[];
  settings: Settings;
}
