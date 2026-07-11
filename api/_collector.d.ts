import type { Dossier } from "../src/data/dossier";
import type { TraceStep } from "../src/data/evidence";
import type { ResolvedInput } from "../src/lib/resolveInput";
import type { TokenDossier } from "../src/token/audit";

/** Typed boundary for the generated server collector bundle. */
export function runAudit(
  handle: string,
  emit?: (step: TraceStep) => void,
): Promise<Dossier | null>;

export function auditToken(
  input: ResolvedInput,
  emit?: (step: TraceStep) => void,
  options?: { skipSim?: boolean },
): Promise<TokenDossier | null>;

export function resolveInput(raw: string): ResolvedInput;

export function providerStatus(): Array<{
  id: string;
  label: string;
  free: boolean;
  feeds: string;
  configured: boolean;
}>;
