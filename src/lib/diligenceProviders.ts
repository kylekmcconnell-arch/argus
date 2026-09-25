export interface DiligenceProviderCandidate {
  id: string; title: string; url: string; excerpt: string;
  attribution: "unresolved"; // A search result never becomes identity, guilt or professional accomplishment.
}
export interface DiligenceProviderReceipt {
  provider: "openalex" | "courtlistener";
  status: "not_configured" | "not_applicable" | "completed" | "empty" | "unavailable";
  capturedAt: string;
  query?: string;
  calls: number;
  estimatedUsd: number | null;
  contentHash?: string;
  candidates: DiligenceProviderCandidate[];
  note: string;
}
