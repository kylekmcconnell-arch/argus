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

/**
 * The session when there is one, null when there is not. For surfaces that
 * legitimately render outside AuthGate: the public share route mounts the
 * full report by share capability, with no account at all. A report that
 * insisted on a session there crashed every shared person link with
 * "useArgusAuth must be used inside AuthGate".
 */
export function useOptionalArgusAuth(): AuthValue | null {
  return useContext(AuthContext);
}
