export interface PersonResearchSource {
  url: string;
  title: string;
  excerpt: string;
  discovery: string;
  access: "search_snippet" | "page_read" | "unavailable";
  capturedAt: string;
  contentHash?: string;
}
export interface PersonResearchResult {
  version: 1;
  name: string;
  company: string;
  capturedAt: string;
  searches: { question: string; status: "searched" | "failed"; count: number }[];
  sources: PersonResearchSource[];
  note: string;
}

/** Only a first-party account binding may join research across reports. */
export function personResearchIdentity(member: { handle?: string; handleProvenance?: string }): string | null {
  const handle = member.handle?.replace(/^@/, "");
  return member.handleProvenance === "subject_first_party" && handle && /^[a-z0-9_]{1,30}$/i.test(handle) ? `x:${handle.toLowerCase()}` : null;
}
