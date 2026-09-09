const PROMOTIONAL_SENTENCE = /\b(?:join (?:the )?revolution|get started(?: today| now)?|discover (?:the )?(?:future|power)|experience (?:the )?(?:future|power)|unlock (?:the )?(?:future|power|potential)|change the world)\b/i;

const PROMOTIONAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bprivacy for any app\b/gi, "a privacy layer for applications"],
  [/\bpowered by DePIN\b/gi, "uses a decentralized physical infrastructure network (DePIN)"],
  [/\bprivacy-first\b/gi, "privacy-focused"],
  [/\bpowered by\b/gi, "uses"],
  [/\breal yield\b/gi, "yield"],
  [/\bseamless(?:ly)?\b/gi, ""],
  [/\brevolutionary\b/gi, ""],
  [/\bgame-changing\b/gi, ""],
  [/\bcutting-edge\b/gi, ""],
  [/\bbest-in-class\b/gi, ""],
  [/\bworld-class\b/gi, ""],
  [/\bnext-generation\b/gi, ""],
  [/\bultimate\b/gi, ""],
  [/\bempowers? (?:people|users) to\b/gi, "lets users"],
];

function cleanSentence(value: string): string {
  const cleaned = PROMOTIONAL_REPLACEMENTS.reduce(
    (sentence, [pattern, replacement]) => sentence.replace(pattern, replacement),
    value,
  )
    .replace(/\bbuilt for freedom\b/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,.;:\s-]+|[,;:\s-]+$/g, "")
    .trim();

  if (!cleaned) return "";
  const sentence = cleaned.replace(/^./, (letter) => letter.toUpperCase());
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * Removes calls to action and common pitch language while preserving the
 * product mechanism. This is display hygiene, not evidence verification.
 */
export function neutralizeProductCopy(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence && !PROMOTIONAL_SENTENCE.test(sentence))
    .map(cleanSentence)
    .filter(Boolean)
    .join(" ");
}
