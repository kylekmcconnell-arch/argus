import { ArgusEyeAssistant } from "./ArgusEyeAssistant";

export interface AskReportProps {
  subject: string;
  reportVersionId?: string;
  /** Legacy callers may still provide display context; it is never sent. */
  context?: string;
}

/**
 * Compatibility wrapper for older imports. New report surfaces mount the
 * shared ArgusEyeAssistant directly so every report uses one conversation,
 * routing, citation, and immutable-version contract.
 */
export function AskReport({ subject, reportVersionId }: AskReportProps) {
  return (
    <ArgusEyeAssistant
      subject={subject}
      reportVersionId={reportVersionId}
      anchorId="ask-report"
    />
  );
}
