/** Separate roles credited to another account from the subject's own role.
 * This does not identify the mentioned person or verify their employment. */
export function subjectBioScope(bio: string, handle: string): { selfDescription: string; creditedHandles: string[]; brandDescription: boolean } {
  const subject = handle.replace(/^@/, "").toLowerCase();
  const creditedHandles: string[] = [];
  let selfDescription = bio.replace(/\b(?:(?:built|founded|created|developed|engineered)\s+by|(?:our\s+)?(?:co-?founder|founder|ceo|cto|developer|dev|engineer)\s*:)\s*@([a-z0-9_]{1,30})\b/gi, (text, other: string) => {
    if (other.toLowerCase() === subject) return text;
    creditedHandles.push(other.toLowerCase());
    return " ";
  });
  // A trailing "| dev @alice" credits a builder when a product description
  // precedes it. A leading "Developer @company" remains a personal job claim.
  selfDescription = selfDescription.replace(/([|\n.;])\s*(?:dev|developer|founder|co-?founder|ceo|cto)\s+@([a-z0-9_]{1,30})\b/gi, (text, separator: string, other: string, offset: number) => {
    if (other.toLowerCase() === subject || !/\b(?:protocol|platform|exchange|privacy|marketplace|app)\b/i.test(bio.slice(0, offset))) return text;
    creditedHandles.push(other.toLowerCase());
    return separator;
  });
  // Require a product self-description as well as a separately credited builder.
  // A personal bio ("I build a protocol", "Founder at @project") is not a brand.
  const personal = /\b(?:I(?:'m| am| build| founded| work)|my\s|founder\s+(?:of|at)|co-?founder\s+(?:of|at)|(?:engineer|developer|dev|ceo|cto)\s+(?:at|of)|building\s+@)\b/i.test(selfDescription);
  const product = /\b(?:protocol|platform|exchange|privacy|marketplace|(?:trading|payments?|web|mobile) app|official account)\b/i.test(selfDescription);
  return { selfDescription, creditedHandles: [...new Set(creditedHandles)], brandDescription: creditedHandles.length > 0 && product && !personal };
}
