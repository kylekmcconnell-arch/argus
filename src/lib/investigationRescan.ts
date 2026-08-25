import { isRunnableTokenInput, resolveInput, type RunnableTokenInput } from "./resolveInput";

export function describeInvestigationRescanBlock(address: string): { address: string; reason: string } {
  const trimmed = address.trim();
  if (!trimmed) {
    return { address: address || "(empty)", reason: "the stored report has no contract address to scan." };
  }
  const resolved = resolveInput(trimmed);
  if (resolved.kind !== "token") {
    return { address: trimmed, reason: `ARGUS classified it as a ${resolved.kind}, not a runnable contract.` };
  }
  if (resolved.via === "ticker") {
    return { address: trimmed, reason: "a $ticker is not a runnable contract address. Paste the exact contract or a DexScreener URL." };
  }
  if (resolved.via === "address-candidate") {
    return { address: trimmed, reason: "this value is only an address candidate and must be resolved before a rescan can start." };
  }
  return { address: trimmed, reason: "the address is not a runnable EVM, Solana, or DexScreener input." };
}

export function formatInvestigationRescanError(address: string, reason: string): string {
  return `Rescan could not start. Address used: ${address}. ${reason}`;
}

export function resolveInvestigationRescanInput(address: string):
  | { ok: true; input: RunnableTokenInput }
  | { ok: false; address: string; reason: string } {
  const resolved = resolveInput(address);
  if (isRunnableTokenInput(resolved)) return { ok: true, input: resolved };
  return { ok: false, ...describeInvestigationRescanBlock(address) };
}
