export interface DiligenceSource {
  id: string;
  factId: string;
  topic?: string;
  predicate: string;
  value: string;
  qualifier?: string;
  status: string;
  url: string;
  excerpt: string;
  capturedAt: string;
  contentHash: string;
  relation: "supports" | "contradicts";
  sourceClass: string;
}
export interface DiligenceHypothesis {
  topic: "role_fit" | "advantage" | "defensibility" | "risk_to_thesis";
  text: string;
  sourceIds: string[];
  limitations: string;
  whatWouldChange: string;
  kind: "analytical_hypothesis";
}
export interface DiligenceBrief {
  version: 1;
  subjectKind: "person" | "company";
  capturedAt: string;
  status: "completed" | "partial" | "unavailable";
  sources: DiligenceSource[];
  hypotheses: DiligenceHypothesis[];
  note: string;
}
