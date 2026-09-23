import type { SubjectCategorySnapshot } from "../data/evidence";

const STANDING_LABEL: Record<SubjectCategorySnapshot["tokenStanding"], string> = {
  live_token: "live token",
  token_planned: "token planned",
  no_token: "no token",
  token_unverified: "token unverified",
};

/**
 * Reader-facing chip text for the frozen market category. A non-Web3 company
 * is described by what it is (listed or private), not by the token it was
 * never going to have; `undetermined` says so instead of guessing.
 */
export function subjectCategoryLabel(category: SubjectCategorySnapshot): string {
  if (category.market === "web3") {
    const listed = category.publicListing ? " · listed" : "";
    return `Web3 startup · ${STANDING_LABEL[category.tokenStanding]}${listed}`;
  }
  if (category.market === "non_web3") {
    return category.publicListing ? "Non-Web3 · publicly listed" : "Non-Web3 · private company";
  }
  return "Category undetermined";
}
