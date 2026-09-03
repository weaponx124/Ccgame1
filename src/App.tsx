import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { RequireOwner } from "./components/RequireOwner";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import CustomerForm from "./pages/CustomerForm";
import Schedule from "./pages/Schedule";
import Collections from "./pages/Collections";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/customers" element={<Customers />} />
        <Route
          path="/customers/new"
          element={
            <RequireOwner>
              <CustomerForm />
            </RequireOwner>
          }
        />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route
          path="/customers/:id/edit"
          element={
            <RequireOwner>
              <CustomerForm />
            </RequireOwner>
          }
        />
        <Route
          path="/collections"
          element={
            <RequireOwner>
              <Collections />
            </RequireOwner>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireOwner>
              <Settings />
            </RequireOwner>
          }
        />
      </Route>
    </Routes>
  );
}
