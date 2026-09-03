import { isFirebaseConfigured } from "./lib/firebase";
import { LocalStoreProvider } from "./lib/store.local";
import { AuthProvider, useAuth } from "./lib/auth";
import { CloudStoreProvider } from "./lib/store.cloud";
import { LoginScreen } from "./components/LoginScreen";
import App from "./App";

export default function AppRoot() {
  if (!isFirebaseConfigured) {
    return (
      <LocalStoreProvider>
        <App />
      </LocalStoreProvider>
    );
  }
  return (
    <AuthProvider>
      <CloudGate />
    </AuthProvider>
  );
}

function CloudGate() {
  const { status, role, logout } = useAuth();

  if (status === "loading") {
    return <div className="min-h-dvh flex items-center justify-center text-bark-600">Loading…</div>;
  }
  if (status === "signedOut") {
    return <LoginScreen />;
  }
  if (!role) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center text-center p-6 gap-3 text-bark-600">
        <p>Your account isn't set up with a role yet.</p>
        <p className="text-sm">Ask the owner to add you in the Firebase console.</p>
        <button onClick={() => logout()} className="text-sm text-moss-700 font-medium underline underline-offset-2">
          Sign out
        </button>
      </div>
    );
  }
  return (
    <CloudStoreProvider role={role}>
      <App />
    </CloudStoreProvider>
  );
}
