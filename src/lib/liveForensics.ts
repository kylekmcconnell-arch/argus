export type LiveForensicCheckState = "running" | "complete" | "unavailable";

export interface LiveForensicCheckUpdate {
  id: string;
  label: string;
  state: LiveForensicCheckState;
}

export type LiveForensicStatusHandler = (update: LiveForensicCheckUpdate) => void;
