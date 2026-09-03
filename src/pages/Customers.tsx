import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { Badge, Card, EmptyState, PrimaryButton } from "../components/ui";
import { PlusIcon, SearchIcon, UsersIcon } from "../components/icons";
import { FREQUENCY_LABELS } from "../types";
import { formatMoney } from "../lib/dates";

export default function Customers() {
  const { customers, jobs } = useStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "contract">("all");

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    for (const job of jobs) {
      if (job.status === "done" && !job.paid) {
        map.set(job.customerId, (map.get(job.customerId) ?? 0) + job.amount);
      }
    }
    return map;
  }, [jobs]);

  const filtered = customers
    .filter((c) => {
      if (filter === "active" && !c.active) return false;
      if (filter === "contract" && !c.isContract) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.phone.includes(q)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-moss-900">Customers</h1>
        <Link to="/customers/new">
          <PrimaryButton>
            <PlusIcon className="h-4 w-4" /> Add
          </PrimaryButton>
        </Link>
      </div>

      {customers.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-12 w-12" />}
          title="No customers yet"
          body="Add your regulars, one-time jobs, and your commercial contract."
          action={
            <Link to="/customers/new">
              <PrimaryButton>
                <PlusIcon className="h-4 w-4" /> Add a customer
              </PrimaryButton>
            </Link>
          }
        />
      ) : (
        <>
          <div className="relative">
            <SearchIcon className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-bark-600/60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, address, phone…"
              className="w-full rounded-xl border border-bark-100 bg-white pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-moss-500/40"
            />
          </div>

          <div className="flex gap-2">
            {(["all", "active", "contract"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  filter === f ? "bg-moss-700 text-white" : "bg-bark-100 text-bark-600"
                }`}
              >
                {f === "all" ? "All" : f === "active" ? "Active" : "Contract"}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filtered.map((customer) => {
              const balance = balances.get(customer.id) ?? 0;
              return (
                <Link key={customer.id} to={`/customers/${customer.id}`}>
                  <Card className="p-3.5 flex items-center gap-3 hover:bg-bark-50/60 transition">
                    <div className="h-10 w-10 rounded-full bg-moss-100 text-moss-700 flex items-center justify-center font-semibold shrink-0">
                      {customer.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-moss-900 truncate">{customer.name}</p>
                      <p className="text-sm text-bark-600 truncate">
                        {customer.isContract ? "Contract" : FREQUENCY_LABELS[customer.frequency]}
                        {customer.address ? ` · ${customer.address}` : ""}
                      </p>
                    </div>
                    {balance > 0 ? (
                      <Badge tone="rust">{formatMoney(balance)} due</Badge>
                    ) : !customer.active ? (
                      <Badge>Inactive</Badge>
                    ) : (
                      <Badge tone="moss">Paid up</Badge>
                    )}
                  </Card>
                </Link>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-bark-600 py-8">No customers match your search.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
