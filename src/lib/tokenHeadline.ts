/** PASS headline facts: chain-correct control language, no fake team identity. */

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function tokenPassHeadline(input: {
  chain: string;
  ownerRenounced: boolean;
  pausable?: boolean;
  lpLocked: boolean;
  projectX?: string | null;
}): string {
  const solana = input.chain === "solana";
  let control: string;
  if (solana) {
    control = input.ownerRenounced
      ? "Mint and freeze authorities have been revoked"
      : "Mint or freeze authority is still live";
  } else if (input.ownerRenounced) {
    control = input.pausable
      ? "Ownership has been renounced, but trading can still be paused"
      : "Ownership has been renounced";
  } else {
    control = "The owner still has control";
  }
  const liquidity = input.lpLocked
    ? "Liquidity-provider tokens are locked"
    : "Liquidity lock was not confirmed";
  const handle = input.projectX?.trim()
    ? ` A public X account on the market record is ${input.projectX}. That is not independent confirmation of the team.`
    : "";
  return `Most forensic checks passed. ${sentence(control)} ${sentence(liquidity)} Depth figures are from the selected pool, not the whole market.${handle}`;
}
