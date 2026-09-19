import { createContext, useContext } from "react";
import type { ChapterId } from "./model";

/** Report-wide facts every control needs: identity of the frozen version and
    whether the viewer may act. Chapters receive their data as props. */
export interface ArgusReportRuntime {
  subjectName: string;
  /** Subject reference the challenge API binds to (handle or token address). */
  subjectRef: string;
  caseLabel: string | null;
  auditId: string;
  reportVersionId?: string;
  version?: number;
  savedAt?: string;
  officialDomain?: string | null;
  /** Share recipients and the shared-view preview: reading only. */
  readOnly: boolean;
  goTo: (chapter: ChapterId) => void;
  toast: (text: string) => void;
}

const ArgusReportContext = createContext<ArgusReportRuntime | null>(null);

export const ArgusReportProvider = ArgusReportContext.Provider;

export function useArgusReport(): ArgusReportRuntime {
  const value = useContext(ArgusReportContext);
  if (!value) throw new Error("useArgusReport must be used inside ArgusReportProvider");
  return value;
}
