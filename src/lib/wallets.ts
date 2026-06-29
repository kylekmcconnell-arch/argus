// Shared wallet presentation helpers — used by the find-wallet tool and the
// report's "Wallets & on-chain links" section so explorer links, address
// truncation, and attribution-tier badges stay consistent across the app.

export const explorer = (w: { address: string; chain: string }): string =>
  w.chain === "solana" ? `https://solscan.io/account/${w.address}` : `https://etherscan.io/address/${w.address}`;

export const shortAddr = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

// Attribution tier: HOW STRONGLY a wallet is tied to the subject — the single
// most important thing to convey, because a forensic claim is only as good as
// its link integrity. Farcaster verification is cryptographic proof the user
// controls the address; self-disclosure is their own on-record claim; a
// handle-name match (vitalik.eth for @vitalik) is a guess anyone could own.
// Lower rank = higher integrity (sorts verified wallets to the top).
export interface WalletTierView {
  rank: number;
  label: string;
  color: string;
}
export function walletTier(w: { link_tier?: string; notes?: string }): WalletTierView {
  const notes = (w.notes ?? "").toLowerCase();
  if (notes.includes("farcaster verified")) return { rank: 0, label: "Verified on-chain", color: "var(--color-pass)" };
  if (/unconfirmed|handle-name match/.test(notes)) return { rank: 3, label: "Unconfirmed", color: "var(--color-caution)" };
  if (w.link_tier === "SelfDoxxed" || notes.includes("self-disclosed")) return { rank: 1, label: "Self-disclosed", color: "var(--color-signal-dim)" };
  return { rank: 2, label: w.link_tier || "Attributed", color: "var(--color-ink-faint)" };
}
