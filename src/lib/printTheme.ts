// The exported PDF is the website on paper. Whatever theme is on screen, the
// print engine renders the LIGHT theme - the product's default visual surface -
// by flipping data-theme for the duration of the print pass and restoring the
// user's choice afterwards. Because this reuses the site's own tokens, the PDF
// can never drift from the website's styling (no duplicated palette in print
// CSS). Never persists: the on-screen preference is untouched.
import { applyArgusTheme, currentArgusTheme, type ArgusTheme } from "./theme";

interface PrintEventTarget {
  addEventListener(type: "beforeprint" | "afterprint", listener: () => void): void;
  removeEventListener(type: "beforeprint" | "afterprint", listener: () => void): void;
}

export function installPrintTheme(target: PrintEventTarget): () => void {
  let restoreTo: ArgusTheme | null = null;
  const onBefore = () => {
    const current = currentArgusTheme();
    if (current === "light") return; // nothing to flip; afterprint restores nothing
    restoreTo = current;
    applyArgusTheme("light");
  };
  const onAfter = () => {
    if (restoreTo == null) return;
    applyArgusTheme(restoreTo);
    restoreTo = null;
  };
  target.addEventListener("beforeprint", onBefore);
  target.addEventListener("afterprint", onAfter);
  return () => {
    target.removeEventListener("beforeprint", onBefore);
    target.removeEventListener("afterprint", onAfter);
  };
}
