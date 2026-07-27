/**
 * Is this person still at the company they are presented as running?
 *
 * A founder who quietly stopped listing a project is one of the sharpest
 * diligence signals there is, and it is invisible to a scan that only records
 * that a name once appeared on a team page. Employment records carry start and
 * end dates; a role with an end date is a departure, and the date is the story.
 *
 * Pure derivation over already-collected records. It reports what the record
 * says and never infers a reason for leaving.
 */
export interface EmploymentRecord {
  company?: string | null;
  title?: string | null;
  start?: string | null;
  end?: string | null;
}

export type EmploymentState = "current" | "departed" | "absent";

export interface EmploymentCurrency {
  state: EmploymentState;
  /** Company name as the employment record spells it. */
  company?: string;
  title?: string;
  start?: string;
  /** End date exactly as recorded, present only when departed. */
  end?: string;
  /** One plain sentence for the report. */
  summary: string;
}

const normalize = (value: string): string =>
  value.toLowerCase().replace(/\b(?:inc|llc|ltd|limited|corp|corporation|labs?|group|holdings?|technologies|tech|foundation|protocol|network|ai)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Same company, allowing for suffix noise ("Orbit" vs "Orbit Group AI Inc"). */
function sameCompany(recordName: string, target: string): boolean {
  const a = normalize(recordName);
  const b = normalize(target);
  if (!a || !b) return false;
  if (a === b) return true;
  const aTokens = a.split(" ").filter(Boolean);
  const bTokens = b.split(" ").filter(Boolean);
  if (!aTokens.length || !bTokens.length) return false;
  // Every token of the shorter name appears in the longer one, so "Orbit"
  // matches "Orbit Group" but "Orbit" never matches "Orbital Insight".
  const [shorter, longer] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  return shorter.every((token) => longer.includes(token));
}

const monthYear = (value: string): string => {
  const match = value.match(/^(\d{4})-(\d{2})/);
  if (!match) return value;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = months[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : match[1];
};

export function employmentCurrency(
  records: readonly EmploymentRecord[],
  company: string,
  person?: string,
): EmploymentCurrency {
  const who = person?.trim() ? person.trim() : "This person";
  const matches = records.filter((record) =>
    typeof record.company === "string" && sameCompany(record.company, company));
  if (!matches.length) {
    return {
      state: "absent",
      summary: `${who} has no ${company} role on their employment record. That record may simply be incomplete, so it is not evidence they were never involved.`,
    };
  }
  // A role with no end date is the live one. Prefer it over any closed role at
  // the same company (people are re-hired, and titles change).
  const open = matches.find((record) => !record.end?.trim());
  if (open) {
    return {
      state: "current",
      company: open.company ?? company,
      ...(open.title ? { title: open.title } : {}),
      ...(open.start ? { start: open.start } : {}),
      summary: `${who} still lists ${open.title ? `${open.title} at ` : ""}${open.company ?? company} as a current role${open.start ? `, held since ${monthYear(open.start)}` : ""}.`,
    };
  }
  const latest = [...matches].sort((a, b) => String(b.end ?? "").localeCompare(String(a.end ?? "")))[0];
  const ended = String(latest.end ?? "").trim();
  return {
    state: "departed",
    company: latest.company ?? company,
    ...(latest.title ? { title: latest.title } : {}),
    ...(latest.start ? { start: latest.start } : {}),
    ...(ended ? { end: ended } : {}),
    summary: `${who} no longer lists ${latest.company ?? company} as a current role: the record ends ${ended ? monthYear(ended) : "on an unstated date"}${latest.title ? ` (${latest.title})` : ""}.`,
  };
}
