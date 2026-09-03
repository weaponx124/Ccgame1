import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Role } from "./storeContext";

interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  uid: string | null;
  role: Role | null;
  name: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null | undefined>(undefined);
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => setFirebaseUser(u));
  }, []);

  useEffect(() => {
    if (!db || !firebaseUser) {
      setRole(null);
      setName("");
      return;
    }
    return onSnapshot(doc(db, "users", firebaseUser.uid), (snap) => {
      const data = snap.data();
      setRole((data?.role as Role) ?? null);
      setName((data?.name as string) ?? "");
    });
  }, [firebaseUser]);

  const status: AuthState["status"] =
    firebaseUser === undefined ? "loading" : firebaseUser === null ? "signedOut" : "signedIn";

  const value: AuthState = {
    status,
    uid: firebaseUser?.uid ?? null,
    role,
    name,
    async login(email, password) {
      if (!auth) throw new Error("Firebase isn't configured.");
      await signInWithEmailAndPassword(auth, email, password);
    },
    async logout() {
      if (!auth) return;
      await signOut(auth);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Like useAuth, but returns null instead of throwing when there's no AuthProvider (local-only mode). */
export function useAuthOptional(): AuthState | null {
  return useContext(AuthContext);
}
