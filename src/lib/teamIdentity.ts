const canonicalPart = (value?: string | null): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(" ");

const canonicalName = (value?: string | null): string => {
  const raw = (value ?? "").trim();
  if (!raw || raw.startsWith("@")) return "";
  const normalized = canonicalPart(raw);
  return normalized.split(" ").length >= 2 ? normalized : "";
};

const canonicalHandle = (value?: string | null): string =>
  (value ?? "").trim().replace(/^@/, "").toLowerCase();

/**
 * Stable referent keys for project-team rows.
 *
 * Handles are authoritative. Exact multi-part names preserve the existing
 * deterministic name-only join. Some search results append the terminal label
 * "Independent" to a person's display name (for example, "Jun Song
 * Independent"). That word is provider presentation, not identity. It is only
 * admitted as a role-qualified alias, so it cannot merge two people in
 * different project roles merely because one has a similar name.
 */
export function teamIdentityKeys(member: {
  name?: string | null;
  handle?: string | null;
  role?: string | null;
}): string[] {
  const keys: string[] = [];
  const handle = canonicalHandle(member.handle);
  if (handle) keys.push(`handle:${handle}`);

  const name = canonicalName(member.name);
  if (!name) return keys;
  keys.push(`name:${name}`);

  const role = canonicalPart(member.role);
  if (!role) return keys;
  keys.push(`role-name:${role}:${name}`);

  const withoutSearchDescriptor = name.replace(/\s+independent$/, "");
  if (withoutSearchDescriptor !== name && withoutSearchDescriptor.split(" ").length >= 2) {
    keys.push(`role-name:${role}:${withoutSearchDescriptor}`);
  }
  return [...new Set(keys)];
}
