// Who is running audits — the analyst tag stamped on shared audit-log rows and
// graph contributions, so Kyle and Enigma can tell their scans apart. Stored
// locally; defaults to "anonymous" so sharing works with zero setup.
const KEY = "argus:analyst";

export function getAnalyst(): string {
  try {
    const v = localStorage.getItem(KEY);
    return v && v.trim() ? v.trim() : "anonymous";
  } catch {
    return "anonymous";
  }
}

export function setAnalyst(name: string): void {
  try {
    const clean = name.trim().slice(0, 40);
    if (clean) localStorage.setItem(KEY, clean);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — non-fatal */
  }
}
