import type { ReactNode } from "react";
import type { Dossier } from "../../data/dossier";
import type { PanoptesEdge, PanoptesNode } from "../../engine";
import type { SubjectConnection } from "../../graph/network";
import type { GithubAssessment } from "../../data/evidence";
import type { SocialActivitySnapshot } from "../../data/socialActivity";
import type { DecisionLensId } from "../../intelligence/types";
import type { TokenDecisionBoundary } from "../../lib/decisionBoundary";
import type { DecisionDiscovery, VerdictArgument } from "../../lib/reportInsights";

export type DecisionCanvasTone = "pass" | "caution" | "signal" | "avoid" | "neutral";

export interface DecisionCanvasItem {
  label: string;
  detail?: string | undefined;
  impactAxis?: string | undefined;
  impact?: string | undefined;
}

export interface DecisionCanvasCompositionRow {
  axis: string;
  label: string;
  score: number;
  weight: number;
  rationale: string;
  supportCount?: number;
  counterCount?: number;
  questionCount?: number;
  evidenceHref?: `#${string}` | null;
  tone?: "pass" | "caution" | "fail";
  sublabel?: string;
  countsLine?: string;
  applicability?: "not_applicable" | "deferred";
}

export interface DecisionCanvasScore {
  label: string;
  score: number | null;
  verdictLabel: string;
  context?: string | undefined;
  composition?: DecisionCanvasCompositionRow[] | undefined;
  scoreIsProvisional?: boolean | undefined;
  successful?: number | undefined;
  applicable?: number | undefined;
  checkScopeLabel?: string | undefined;
  unavailableCopy?: string | undefined;
}

export interface InvestigationDecisionCanvasProps {
  presentationStyle?: 1 | 2;
  subjectName?: string | undefined;
  subjectSummary?: string | null | undefined;
  reportSummary?: string | null | undefined;
  verdictLabel: string;
  score: number | null;
  scoreLabel?: string;
  scoreContext?: string;
  scoreIsProvisional?: boolean;
  favorable: boolean;
  verdictTone: DecisionCanvasTone;
  argument?: VerdictArgument | undefined;
  discovery?: DecisionDiscovery | null | undefined;
  decisionBoundary?: TokenDecisionBoundary | null | undefined;
  decisionBoundaryEvidenceHref?: `#${string}` | undefined;
  decisionLensId?: DecisionLensId | undefined;
  onDecisionLensChange?: ((lensId: DecisionLensId) => void) | undefined;
  supports: DecisionCanvasItem[];
  concerns: DecisionCanvasItem[];
  context?: DecisionCanvasItem[];
  nextSteps: DecisionCanvasItem[];
  verified: DecisionCanvasItem[];
  coveragePercent: number;
  successful: number;
  applicable: number;
  capturedAt?: string | undefined;
  evidenceHref?: `#${string}`;
  methodologyHref?: `#${string}`;
  challengeAnchorId?: string | null;
  checkScopeLabel?: string;
  openItemsLabel?: string;
  composition?: DecisionCanvasCompositionRow[];
  secondaryScore?: DecisionCanvasScore | null | undefined;
  showDecisionDetails?: boolean;
}

export interface ConnectionWorkspaceProps {
  dossier: Dossier;
  nodes: PanoptesNode[];
  edges: PanoptesEdge[];
  connections: SubjectConnection[];
  onAudit?: ((query: string, privateSearch?: boolean) => void) | undefined;
  onOpenSavedReport?: ((query: string, kind: "person" | "token") => void) | undefined;
  onOpenProject?: ((name: string) => void) | undefined;
  shareView?: boolean | undefined;
  previewBalance?: number | undefined;
}

/**
 * Presentation-only slots over a frozen saved report. Renderers cannot alter
 * evidence collection, saved scores, or report identity.
 */
export interface ReportLaneRenderers {
  decisionCanvas?: (props: InvestigationDecisionCanvasProps) => ReactNode;
  connectionWorkspace?: (props: ConnectionWorkspaceProps) => ReactNode;
  socialSynthesis?: (snapshot: SocialActivitySnapshot) => ReactNode;
  githubSynthesis?: (assessment: GithubAssessment) => ReactNode;
}
