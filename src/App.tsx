import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
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
        <Route path="/customers/new" element={<CustomerForm />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/customers/:id/edit" element={<CustomerForm />} />
        <Route path="/collections" element={<Collections />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
