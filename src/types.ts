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

export type JobType = "mowing" | "shrub-trim" | "fertilizer" | "cleanup" | "other";

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  mowing: "Mowing",
  "shrub-trim": "Shrub trim",
  fertilizer: "Fertilizer",
  cleanup: "Cleanup",
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
  settings: Settings;
}
