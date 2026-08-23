import type { Dossier } from "../src/data/dossier";
import type { TraceStep } from "../src/data/evidence";
import type { ResolvedInput, RunnableTokenInput } from "../src/lib/resolveInput";
import type { CollectTokenSocialActivityFn, ScreenDeployerRiskFn, ScreenSanctionsFn, TokenDossier } from "../src/token/audit";
import type { SocialActivitySnapshot } from "../src/data/socialActivity";
import type { ResearchCapability, ResearchIntent } from "../src/lib/researchDirector";

/** Typed boundary for the generated server collector bundle. */
export function runAudit(
  handle: string,
  emit?: (step: TraceStep) => void,
  options?: {
    organizationId?: string;
    analystDeadlineAt?: number;
    intent?: ResearchIntent;
    authorizedResearchScope?: {
      taskIds: readonly string[];
      capabilities: readonly ResearchCapability[];
      delegates: readonly string[];
    };
  },
): Promise<Dossier | null>;

export function auditToken(
  input: RunnableTokenInput,
  emit?: (step: TraceStep) => void,
  options?: { skipSim?: boolean; force?: boolean; screenSanctions?: ScreenSanctionsFn; screenDeployerRisk?: ScreenDeployerRiskFn; collectSocialActivity?: CollectTokenSocialActivityFn },
): Promise<TokenDossier | null>;

export function collectSocialActivity(identity: {
  handle: string;
  ticker?: string | null;
  projectName?: string | null;
}): Promise<SocialActivitySnapshot>;

export function resolveInput(raw: string): ResolvedInput;

export function providerStatus(): Array<{
  id: string;
  label: string;
  free: boolean;
  feeds: string;
  configured: boolean;
}>;
