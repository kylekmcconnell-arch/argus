export type ConversationReferentKind =
  | "person"
  | "organization"
  | "project"
  | "token"
  | "wallet"
  | "subject"
  | "unknown";

export interface ConversationReferent {
  key: string;
  label: string;
  kind: ConversationReferentKind;
  aliases: string[];
  source: "frozen_report";
  ordinal?: number;
}

export interface ConversationReferentResolution {
  state: "not_required" | "resolved" | "ambiguous" | "unresolved";
  expression?: string;
  resolved?: Pick<ConversationReferent, "key" | "label" | "kind">;
  candidates: Array<Pick<ConversationReferent, "key" | "label" | "kind">>;
  requiresClarification: boolean;
  explanation: string;
}

interface ReferenceDescriptor {
  expression: string;
  kind?: ConversationReferentKind;
  ordinal?: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function boundedText(value: unknown, max = 240): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function slug(value: string): string {
  return normalized(value).replace(/^[@$]/, "").replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

function inferredKey(label: string, kind: ConversationReferentKind): string {
  if (label.startsWith("@")) return `x:${slug(label)}`;
  if (label.startsWith("$")) return `token:${slug(label)}`;
  if (/^0x[a-z0-9]+$/i.test(label)) return `wallet:${normalized(label)}`;
  return `${kind}:${slug(label) || "unnamed"}`;
}

function graphKind(value: unknown): ConversationReferentKind {
  const type = normalized(boundedText(value, 80));
  if (/person|founder|operator|investor/.test(type)) return "person";
  if (/wallet|address|deployer|funder|holder/.test(type)) return "wallet";
  if (/token|asset|contract/.test(type)) return "token";
  if (/project|protocol/.test(type)) return "project";
  if (/company|firm|fund|organization|agency/.test(type)) return "organization";
  return "unknown";
}

function roleKind(value: string): ConversationReferentKind {
  const role = normalized(value);
  if (/founder|person|officer|director|advisor|developer|operator|employee|member/.test(role)) return "person";
  if (/fund|firm|company|organization|agency/.test(role)) return "organization";
  return "person";
}

function roleAliases(value: string): string[] {
  const role = normalized(value);
  const nouns = ["founder", "cofounder", "advisor", "director", "officer", "operator", "developer", "investor", "fund", "firm", "company"];
  return [value, ...nouns.filter((noun) => role.includes(noun)).flatMap((noun) => [noun, `the ${noun}`])];
}

function compactCandidate(referent: ConversationReferent) {
  return { key: referent.key, label: referent.label, kind: referent.kind };
}

/**
 * Build a bounded entity register only from the server-projected frozen packet.
 * Candidate leads are deliberately ignored: an unverified lead cannot become a
 * conversational identity merely because it has a convenient name.
 */
export function buildConversationReferentRegister(packetValue: unknown): ConversationReferent[] {
  const packet = record(packetValue);
  const byKey = new Map<string, ConversationReferent>();
  let walletOrdinal = 0;

  const add = (input: {
    key?: unknown;
    label?: unknown;
    kind: ConversationReferentKind;
    aliases?: unknown[];
  }) => {
    const label = boundedText(input.label);
    if (!label) return;
    const rawKey = boundedText(input.key, 160);
    const key = input.kind === "wallet" && /^0x[a-z0-9]+$/i.test(rawKey)
      ? `wallet:${normalized(rawKey)}`
      : rawKey.startsWith("@")
        ? `x:${slug(rawKey)}`
        : rawKey.startsWith("$")
          ? `token:${slug(rawKey)}`
          : rawKey || inferredKey(label, input.kind);
    if (!key) return;
    const aliases = [label, key, ...(input.aliases ?? []).map((value) => boundedText(value)).filter(Boolean)]
      .map(normalized)
      .filter((value) => value.length >= 2);
    const existing = byKey.get(key);
    if (existing) {
      const inferredDuplicate = [...byKey.values()].find((candidate) => (
        candidate.key !== key
        && candidate.kind === input.kind
        && candidate.key === inferredKey(candidate.label, candidate.kind)
        && normalized(candidate.label) === normalized(label)
      ));
      existing.aliases = [...new Set([
        ...existing.aliases,
        ...(inferredDuplicate?.aliases ?? []),
        ...aliases,
      ])].slice(0, 16);
      if (inferredDuplicate) byKey.delete(inferredDuplicate.key);
      if (existing.kind === "unknown" && input.kind !== "unknown") existing.kind = input.kind;
      return;
    }
    if (byKey.size >= 120) return;
    const referent: ConversationReferent = {
      key,
      label,
      kind: input.kind,
      aliases: [...new Set(aliases)].slice(0, 16),
      source: "frozen_report",
    };
    if (input.kind === "wallet") {
      walletOrdinal += 1;
      referent.ordinal = walletOrdinal;
    }
    byKey.set(key, referent);
  };

  const intelligence = record(packet.intelligence);
  const intelligenceSubject = record(intelligence.subject);
  add({
    key: intelligenceSubject.key,
    label: intelligenceSubject.label || packet.subject,
    kind: boundedText(intelligenceSubject.entityKind, 80) === "person" || boundedText(intelligenceSubject.entityKind, 80) === "individual_investor"
      ? "person"
      : /firm|company/.test(boundedText(intelligenceSubject.entityKind, 80))
        ? "organization"
        : "subject",
    aliases: [packet.subject],
  });
  const attributions = values(packet.projectAttributions).map(record);
  for (const attribution of attributions) {
    const role = boundedText(attribution.role, 120);
    add({
      label: attribution.name,
      kind: roleKind(role),
      aliases: roleAliases(role),
    });
    add({ label: attribution.project, kind: "project" });
  }

  const investigation = record(packet.investigationReasoning);
  const thesis = record(investigation.thesis);
  const tokenKey = boundedText(thesis.contract, 160)
    || inferredKey(boundedText(thesis.symbol, 80) || boundedText(thesis.subject), "token");
  add({ key: tokenKey, label: thesis.subject || thesis.symbol || thesis.contract, kind: "token", aliases: [thesis.symbol, thesis.contract] });

  const projectEvidence = record(investigation.projectEvidence);
  const projectLabel = boundedText(projectEvidence.name || projectEvidence.handle);
  const projectKey = projectLabel
    && normalized(projectLabel) === normalized(boundedText(intelligenceSubject.label))
    ? boundedText(intelligenceSubject.key, 160)
    : boundedText(projectEvidence.handle, 160);
  add({
    key: projectKey,
    label: projectEvidence.name || projectEvidence.handle,
    kind: "project",
    aliases: [projectEvidence.handle],
  });
  for (const member of values(projectEvidence.verifiedTeam)) {
    const row = record(member);
    if (Object.keys(row).length) {
      add({ label: row.name || row.handle, key: row.key || row.handle, kind: "person", aliases: [row.handle, row.role] });
    } else {
      add({ label: member, kind: "person" });
    }
  }

  const connections = record(investigation.connections);
  for (const graphValue of [connections.tokenGraph, connections.projectGraph]) {
    const graph = record(graphValue);
    for (const nodeValue of values(graph.nodes)) {
      const node = record(nodeValue);
      const kind = graphKind(node.type || node.subtype);
      add({
        key: kind === "token" && node.subject === true
          ? tokenKey
          : kind === "project" && node.subject === true
            ? projectKey
            : node.key,
        label: node.label || node.key,
        kind,
        aliases: [node.key],
      });
    }
  }

  add({ key: connections.deployer, label: connections.deployer, kind: "wallet", aliases: ["deployer", "deployer wallet"] });
  const deployerTrail = record(connections.deployerTrail);
  add({ key: deployerTrail.wallet, label: deployerTrail.wallet, kind: "wallet", aliases: ["deployer", "deployer wallet"] });
  const funder = record(deployerTrail.funder);
  add({ key: funder.address, label: funder.label || funder.address, kind: "wallet", aliases: [funder.address, "funder", "funding wallet"] });
  for (const hopValue of values(deployerTrail.chain)) {
    const hop = record(hopValue);
    add({ key: hop.address || hop.wallet, label: hop.label || hop.address || hop.wallet, kind: "wallet" });
  }

  const tokenEvidence = record(investigation.tokenEvidence);
  for (const holderValue of values(tokenEvidence.topHolders)) {
    const holder = record(holderValue);
    add({ key: holder.address, label: holder.label || holder.address, kind: "wallet", aliases: [holder.address, holder.label] });
  }

  return [...byKey.values()];
}

function referenceDescriptor(question: string): ReferenceDescriptor | null {
  const ordinal = question.match(/\b(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+(wallet|founder|person|fund|firm|company|project|token)\b/i);
  if (ordinal) {
    const index = ["first", "second", "third", "fourth", "fifth", "1st", "2nd", "3rd", "4th", "5th"].indexOf(ordinal[1].toLowerCase());
    const ordinalNumber = index >= 5 ? index - 4 : index + 1;
    return { expression: ordinal[0], kind: nounKind(ordinal[2]), ordinal: ordinalNumber };
  }
  const typed = question.match(/\b(?:that|this|their)\s+(founder|person|fund|firm|company|project|token|wallet)\b/i);
  if (typed) return { expression: typed[0], kind: nounKind(typed[1]) };
  const pronoun = question.match(/\b(he|him|his|she|her|hers|they|them|their|theirs)\b/i);
  if (!pronoun) return null;
  const gendered = /^(?:he|him|his|she|her|hers)$/i.test(pronoun[1]);
  return { expression: pronoun[0], ...(gendered ? { kind: "person" as const } : {}) };
}

function nounKind(noun: string): ConversationReferentKind {
  const value = normalized(noun);
  if (value === "founder" || value === "person") return "person";
  if (value === "fund" || value === "firm" || value === "company") return "organization";
  if (value === "project") return "project";
  if (value === "token") return "token";
  if (value === "wallet") return "wallet";
  return "unknown";
}

function kindCompatible(referent: ConversationReferent, expected?: ConversationReferentKind): boolean {
  if (!expected) return true;
  if (referent.kind === expected) return true;
  return expected === "organization" && referent.kind === "project";
}

function aliasAppears(text: string, alias: string): boolean {
  const haystack = normalized(text);
  const needle = normalized(alias);
  if (!needle || needle.length < 2) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

function mentionedReferents(text: string, register: readonly ConversationReferent[], expected?: ConversationReferentKind) {
  return register.filter((referent) => kindCompatible(referent, expected)
    && referent.aliases.some((alias) => aliasAppears(text, alias)));
}

/** Resolve one entity reference without consulting dialogue answers or a model. */
export function resolveConversationReferent(
  question: string,
  priorQuestions: readonly string[],
  register: readonly ConversationReferent[],
): ConversationReferentResolution {
  const descriptor = referenceDescriptor(question);
  if (!descriptor) {
    return {
      state: "not_required",
      candidates: [],
      requiresClarification: false,
      explanation: "The question contains no entity reference that requires conversational binding.",
    };
  }

  const compatible = register.filter((referent) => kindCompatible(referent, descriptor.kind));
  if (descriptor.ordinal != null) {
    const ordinalCandidates = compatible.filter((referent) => referent.kind === descriptor.kind);
    const resolved = ordinalCandidates.find((referent) => referent.ordinal === descriptor.ordinal)
      ?? ordinalCandidates[descriptor.ordinal - 1];
    if (resolved) {
      return {
        state: "resolved",
        expression: descriptor.expression,
        resolved: compactCandidate(resolved),
        candidates: [compactCandidate(resolved)],
        requiresClarification: false,
        explanation: `The ordinal reference resolves to frozen ${resolved.kind} ${resolved.key}.`,
      };
    }
    return {
      state: "unresolved",
      expression: descriptor.expression,
      candidates: ordinalCandidates.map(compactCandidate).slice(0, 8),
      requiresClarification: true,
      explanation: `The frozen report does not contain a ${descriptor.expression} referent.`,
    };
  }

  for (const priorQuestion of [...priorQuestions].reverse()) {
    const mentioned = mentionedReferents(priorQuestion, register, descriptor.kind);
    if (mentioned.length === 1) {
      const resolved = mentioned[0];
      return {
        state: "resolved",
        expression: descriptor.expression,
        resolved: compactCandidate(resolved),
        candidates: [compactCandidate(resolved)],
        requiresClarification: false,
        explanation: `The reference resolves from the prior user question to frozen ${resolved.kind} ${resolved.key}; prior answers remain non-evidence.`,
      };
    }
    if (mentioned.length > 1) {
      return {
        state: "ambiguous",
        expression: descriptor.expression,
        candidates: mentioned.map(compactCandidate).slice(0, 8),
        requiresClarification: true,
        explanation: "The latest user question names more than one compatible frozen-report entity.",
      };
    }
  }

  const currentMentions = mentionedReferents(question, register, descriptor.kind);
  const candidates = currentMentions.length ? currentMentions : compatible;
  if (candidates.length === 1) {
    const resolved = candidates[0];
    return {
      state: "resolved",
      expression: descriptor.expression,
      resolved: compactCandidate(resolved),
      candidates: [compactCandidate(resolved)],
      requiresClarification: false,
      explanation: `Exactly one compatible frozen-report entity exists: ${resolved.key}.`,
    };
  }
  return {
    state: candidates.length ? "ambiguous" : "unresolved",
    expression: descriptor.expression,
    candidates: candidates.map(compactCandidate).slice(0, 8),
    requiresClarification: true,
    explanation: candidates.length
      ? "More than one frozen-report entity fits the reference."
      : "No frozen-report entity fits the reference.",
  };
}
