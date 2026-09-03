import { NavLink, Outlet } from "react-router-dom";
import { CalendarIcon, CashIcon, GearIcon, HomeIcon, UsersIcon } from "./icons";
import { useStore } from "../lib/storeContext";
import { useAuthOptional } from "../lib/auth";
import { totalOwed } from "../lib/contact";

const ALL_NAV_ITEMS = [
  { to: "/", label: "Home", icon: HomeIcon, end: true, ownerOnly: false },
  { to: "/schedule", label: "Schedule", icon: CalendarIcon, end: false, ownerOnly: false },
  { to: "/customers", label: "Customers", icon: UsersIcon, end: false, ownerOnly: false },
  { to: "/collections", label: "Money", icon: CashIcon, end: false, ownerOnly: true },
  { to: "/settings", label: "Settings", icon: GearIcon, end: false, ownerOnly: true },
];

export default function Layout() {
  const { jobs, role } = useStore();
  const auth = useAuthOptional();
  const isOwner = role === "owner";
  const navItems = ALL_NAV_ITEMS.filter((item) => isOwner || !item.ownerOnly);
  const owed = isOwner ? totalOwed(jobs) : 0;
  const owedCount = isOwner ? jobs.filter((j) => j.status === "done" && !j.paid).length : 0;

  return (
    <div className="min-h-dvh bg-bark-50 text-moss-900 flex flex-col md:flex-row">
      <aside className="hidden md:flex md:w-64 md:flex-col border-r border-bark-100 bg-white px-4 py-6 gap-1 sticky top-0 h-dvh">
        <div className="flex items-center gap-2 px-2 pb-6">
          <div className="h-9 w-9 rounded-xl bg-moss-800 flex items-center justify-center text-moss-200 font-bold">
            Y
          </div>
          <div>
            <p className="font-semibold leading-tight">YardBook</p>
            <p className="text-xs text-bark-600 leading-tight">
              {isOwner ? "job & payment tracker" : "crew view"}
            </p>
          </div>
        </div>
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive ? "bg-moss-100 text-moss-800" : "text-bark-600 hover:bg-bark-50"
              }`
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
            {label === "Money" && owedCount > 0 && (
              <span className="ml-auto text-xs font-semibold text-white bg-rust-500 rounded-full px-2 py-0.5">
                {owedCount}
              </span>
            )}
          </NavLink>
        ))}
        {owed > 0 && (
          <div className="mt-auto rounded-xl bg-clay-400/15 border border-clay-400/30 px-3 py-3 text-sm">
            <p className="text-bark-600">Outstanding</p>
            <p className="text-lg font-semibold text-clay-600">
              {owed.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
            </p>
          </div>
        )}
        {auth && (
          <button
            onClick={() => auth.logout()}
            className={`text-sm text-bark-600 hover:text-moss-800 px-3 py-2 text-left ${owed > 0 ? "" : "mt-auto"}`}
          >
            Sign out{auth.name ? ` (${auth.name})` : ""}
          </button>
        )}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden safe-top sticky top-0 z-20 bg-moss-800 text-moss-50 px-4 py-3 flex items-center gap-2 shadow-sm">
          <div className="h-7 w-7 rounded-lg bg-moss-600 flex items-center justify-center text-xs font-bold">Y</div>
          <span className="font-semibold">YardBook{!isOwner ? " · Crew" : ""}</span>
          {owedCount > 0 && (
            <span className="ml-auto text-xs font-semibold bg-rust-500 rounded-full px-2 py-1">
              {owedCount} unpaid
            </span>
          )}
          {auth && (
            <button onClick={() => auth.logout()} className={owedCount > 0 ? "text-xs ml-2 underline" : "ml-auto text-xs underline"}>
              Sign out
            </button>
          )}
        </header>

        <main className="flex-1 min-w-0 pb-24 md:pb-8">
          <Outlet />
        </main>

        <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-bark-100 safe-bottom">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}>
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium relative ${
                    isActive ? "text-moss-700" : "text-bark-600/70"
                  }`
                }
              >
                <Icon className="h-5 w-5" />
                {label}
                {label === "Money" && owedCount > 0 && (
                  <span className="absolute top-1 right-[22%] h-2 w-2 rounded-full bg-rust-500" />
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
