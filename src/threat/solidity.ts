// Static Solidity red-flag scanner. This is the keyless floor of the LYRA-style
// code review: a set of conservative pattern detectors that read the verified
// source line by line and cite the exact file + line for every claim, the way a
// human auditor would. The AI pass (api/code-review.ts) reads deeper; this layer
// always runs, even on the static site with no keys.
//
// Design rules:
//  - Every flag anchors to a real line (no vibes).
//  - Regex parsing of Solidity is imperfect, so detectors are conservative:
//    presence of a pattern is reported as a capability, never as proven intent.
//  - Comments and string literals are stripped before matching so a commented-out
//    `selfdestruct` doesn't flag.

import type { CodeFlag, FlagSeverity, SourceFile } from "./types";

interface Fn {
  name: string;
  header: string; // the full signature line(s) collapsed
  start: number; // 1-based line of the `function` keyword
  end: number; // 1-based line of the closing brace
  body: string[]; // stripped lines, start..end inclusive
  gated: boolean; // has an access-control modifier (onlyOwner / custom)
  customGate: string | null; // a privilege modifier that is NOT onlyOwner
}

// Strip line/block comments and gut string literals, preserving line count.
export function stripComments(src: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split("\n")) {
    let line = "";
    for (let i = 0; i < raw.length; i++) {
      if (inBlock) {
        if (raw[i] === "*" && raw[i + 1] === "/") { inBlock = false; i++; }
        continue;
      }
      const two = raw.slice(i, i + 2);
      if (two === "//") break;
      if (two === "/*") { inBlock = true; i++; continue; }
      if (raw[i] === '"' || raw[i] === "'") {
        const q = raw[i];
        i++;
        while (i < raw.length && raw[i] !== q) { if (raw[i] === "\\") i++; i++; }
        line += "''";
        continue;
      }
      line += raw[i];
    }
    out.push(line);
  }
  return out;
}

const GATE_MODS = /\bonly(Owner|Admin|Dev|Team|Deployer|Authorized|Auth|Manager|Operator)\b|\bauthorized\b|\bonlyRole\b/i;
const CUSTOM_GATE = /\bonly(Admin|Dev|Team|Deployer|Manager|Operator)\b|\bauthorized\b/i;

// Walk the stripped source and slice it into functions via brace counting.
export function functionsOf(stripped: string[]): Fn[] {
  const fns: Fn[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const m = stripped[i].match(/^\s*function\s+([A-Za-z0-9_]+)/);
    if (!m) continue;
    // Collapse the header until the opening brace (or a `;` — interface stub).
    let header = stripped[i];
    let j = i;
    while (j < stripped.length && !/[{;]/.test(header)) {
      j++;
      header += " " + (stripped[j] ?? "");
    }
    if (header.includes(";") && !header.includes("{")) continue; // declaration only
    // Brace-match to the end of the body.
    let depth = 0, end = j, seen = false;
    for (let k = j; k < stripped.length; k++) {
      for (const ch of stripped[k]) {
        if (ch === "{") { depth++; seen = true; }
        else if (ch === "}") depth--;
      }
      if (seen && depth <= 0) { end = k; break; }
      end = k;
    }
    const headerOnly = header.slice(0, header.indexOf("{") + 1);
    fns.push({
      name: m[1],
      header: headerOnly,
      start: i + 1,
      end: end + 1,
      body: stripped.slice(i, end + 1),
      gated: GATE_MODS.test(headerOnly),
      customGate: headerOnly.match(CUSTOM_GATE)?.[0] ?? null,
    });
    i = j; // continue after the header; nested functions don't exist in Solidity
  }
  return fns;
}

const excerptOf = (lines: string[], line1: number) => (lines[line1 - 1] ?? "").trim().slice(0, 160);

export function scanSolidity(files: SourceFile[]): CodeFlag[] {
  const flags: CodeFlag[] = [];
  const push = (
    id: string, severity: FlagSeverity, title: string, detail: string,
    file: string, line: number, rawLines: string[],
  ) => {
    // one flag per id+file — a pattern repeated 40 times is one finding
    if (flags.some((f) => f.id === id && f.file === file)) return;
    flags.push({ id, severity, title, detail, file, line, excerpt: excerptOf(rawLines, line) });
  };

  for (const f of files) {
    const raw = f.content.split("\n");
    const stripped = stripComments(f.content);
    const fns = functionsOf(stripped);
    const whole = stripped.join("\n");

    // --- direct one-line patterns ---
    stripped.forEach((line, i0) => {
      const n = i0 + 1;
      if (/\bselfdestruct\s*\(/.test(line))
        push("selfdestruct", "critical", "Contract can self-destruct",
          "A selfdestruct call exists — the contract (and any funds routed through it) can be erased by whoever can reach this path.", f.path, n, raw);
      if (/\bdelegatecall\b/.test(line))
        push("delegatecall", "high", "delegatecall present",
          "The contract executes external code in its own storage context. Behavior can be swapped after you buy.", f.path, n, raw);
      if (/\bassembly\s*[({]/.test(line))
        push("assembly", "info", "Inline assembly",
          "Hand-written EVM assembly bypasses Solidity's guardrails; honest contracts use it too, but it is where tricks hide.", f.path, n, raw);
    });

    // --- blacklist / bot-list machinery ---
    const blMap = stripped.findIndex((l) =>
      /mapping\s*\(\s*address\s*=>\s*bool\s*\)\s*(private|public|internal)?\s*_?(isBlacklisted|blacklist(ed)?s?|bots?|banned|_bots|isBot|blocked)/i.test(l));
    if (blMap >= 0) {
      const used = stripped.findIndex((l) => /require\s*\(\s*!.*(blacklist|bots?|banned|blocked)/i.test(l) || /if\s*\(.*(blacklist|bots?|banned|blocked)\[/i.test(l));
      push("blacklist", "high", "Blacklist machinery",
        "The contract keeps an address blocklist" + (used >= 0 ? " and checks it on transfers — your wallet can be blocked from selling." : " — wallets can be flagged and restricted."),
        f.path, blMap + 1, raw);
    }

    // --- trading switch ---
    const tradeVar = stripped.findIndex((l) => /\bbool\b.*\b(tradingEnabled|tradingOpen|tradingActive|tradingLive|swapEnabled|launched)\b/i.test(l));
    if (tradeVar >= 0) {
      const disabler = fns.find((fn) => fn.body.some((l) => /\b(tradingEnabled|tradingOpen|tradingActive|tradingLive|launched)\s*=\s*false\b/i.test(l)));
      if (disabler) {
        push("trading-switch-off", "critical", "Trading can be switched off",
          `\`${disabler.name}()\` sets the trading flag back to false — the team can halt all selling after launch.`, f.path, disabler.start, raw);
      } else {
        push("trading-switch", "medium", "Trading gate",
          "Trading starts disabled behind a launch flag. Standard for launches, but until enabled, buyers cannot exit.", f.path, tradeVar + 1, raw);
      }
    }

    // --- per-function analysis ---
    for (const fn of fns) {
      const bodyStr = fn.body.join("\n");

      // fake renounce: renounceOwnership that doesn't actually zero the owner
      if (/^renounceOwnership$/i.test(fn.name)) {
        const genuine = /(_transferOwnership|transferOwnership)\s*\(\s*address\(0\)\s*\)|_?owner\s*=\s*address\(0\)|super\.renounceOwnership/i.test(bodyStr);
        if (!genuine)
          push("fake-renounce", "critical", "renounceOwnership is overridden",
            "The renounce function does not hand ownership to the zero address — a renounce announcement from this contract can be theater.", f.path, fn.start, raw);
      }

      // owner-side balance rewrite
      if (fn.gated && !/^(_)?(mint|burn|transfer|transferFrom|_transfer|_mint|_burn|constructor|swap.*|airdrop)$/i.test(fn.name)) {
        const wl = fn.body.findIndex((l) => /_?balances\s*\[[^\]]+\]\s*=(?!=)/.test(l));
        if (wl >= 0)
          push("owner-balance-write", "critical", "Privileged balance rewrite",
            `\`${fn.name}()\` writes holder balances directly under an access-control gate — balances can be edited without a transfer.`, f.path, fn.start + wl, raw);
      }

      // mint under owner control
      if (/^_?mint/i.test(fn.name) && fn.gated)
        push("owner-mint", "high", "Owner-callable mint",
          `\`${fn.name}()\` lets the privileged wallet create new supply at will — holders can be diluted to zero.`, f.path, fn.start, raw);

      // settable fees, bounded or not
      if (/^set.*(fee|tax)s?/i.test(fn.name) && fn.gated) {
        const bounded = /require\s*\([^;]*(<=|<)\s*\d{1,3}/.test(bodyStr);
        push(bounded ? "settable-fee-bounded" : "settable-fee-unbounded",
          bounded ? "medium" : "high",
          bounded ? "Fees are adjustable (bounded)" : "Fees are adjustable with no ceiling",
          bounded
            ? `\`${fn.name}()\` can change taxes after launch, capped by a require — check the ceiling.`
            : `\`${fn.name}()\` can change taxes after launch with no visible upper bound — a 0% tax today can become 99% after you buy.`,
          f.path, fn.start, raw);
      }

      // max wallet / max tx tightening
      if (/^set.*(maxwallet|maxtx|maxtransaction|maxbuy|maxsell)/i.test(fn.name.replace(/_/g, "")) && fn.gated)
        push("settable-limits", "medium", "Transaction limits are adjustable",
          `\`${fn.name}()\` can retune wallet/transaction caps after launch — tightened to dust, it traps holders as effectively as a honeypot.`, f.path, fn.start, raw);

      // secondary privilege gate that survives renounce
      if (fn.customGate)
        push("second-gate", "medium", `Privilege gate beyond the owner (\`${fn.customGate}\`)`,
          "Functions are gated by a role other than the standard owner — renouncing ownership would not disarm this access.", f.path, fn.start, raw);
    }

    // --- pausable transfers ---
    if (/whenNotPaused/.test(whole) && /\b_transfer\b|\btransfer\s*\(/.test(whole)) {
      const ln = stripped.findIndex((l) => /whenNotPaused/.test(l));
      push("pausable", "high", "Transfers are pausable",
        "Token movement runs behind a pause switch — the team can freeze all trading.", f.path, ln + 1, raw);
    }
  }

  const RANK: Record<FlagSeverity, number> = { critical: 3, high: 2, medium: 1, info: 0 };
  return flags.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
}
