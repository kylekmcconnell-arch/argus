import type { Dossier } from "../src/data/dossier";
import type { TraceStep } from "../src/data/evidence";
import type { ResolvedInput, RunnableTokenInput } from "../src/lib/resolveInput";
import type { TokenDossier } from "../src/token/audit";

/** Typed boundary for the generated server collector bundle. */
export function runAudit(
  handle: string,
  emit?: (step: TraceStep) => void,
  options?: { organizationId?: string },
): Promise<Dossier | null>;

export function auditToken(
  input: RunnableTokenInput,
  emit?: (step: TraceStep) => void,
  options?: { skipSim?: boolean; force?: boolean },
): Promise<TokenDossier | null>;

export function resolveInput(raw: string): ResolvedInput;

export function providerStatus(): Array<{
  id: string;
  label: string;
  free: boolean;
  feeds: string;
  configured: boolean;
}>;
