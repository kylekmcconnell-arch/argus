import { createContext, useContext } from "react";

export type ArgusRole = "owner" | "analyst" | "viewer";

export interface ArgusSessionProfile {
  user: { id: string; email: string; displayName: string };
  organizationId: string;
  role: ArgusRole;
}

export interface AuthValue extends ArgusSessionProfile {
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useArgusAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useArgusAuth must be used inside AuthGate");
  return value;
}
