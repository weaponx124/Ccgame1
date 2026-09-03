import { Navigate } from "react-router-dom";
import { useStore } from "../lib/storeContext";

/** Wraps a route that only makes sense for the owner (billing, settings, customer management). */
export function RequireOwner({ children }: { children: React.ReactNode }) {
  const { role } = useStore();
  if (role !== "owner") return <Navigate to="/" replace />;
  return <>{children}</>;
}
