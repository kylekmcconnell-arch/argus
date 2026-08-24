// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectLinks } from "./ProjectLinks";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProjectLinks", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the project site and token site distinct", () => {
    act(() => {
      root.render(
        <ProjectLinks
          websites={[
            { label: "Clutch Markets site", url: "https://clutch.markets" },
            { label: "$SB site", url: "https://stonkbrokers.cash" },
          ]}
          links={[{ label: "Website", url: "https://clutch.markets/docs" }]}
        />,
      );
    });

    const anchors = [...container.querySelectorAll("a")];
    expect(anchors.map((anchor) => anchor.textContent)).toEqual([
      "Clutch Markets site",
      "$SB site",
    ]);
    expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual([
      "https://clutch.markets",
      "https://stonkbrokers.cash",
    ]);
  });

  it("separates the official site, ordered resources, and contract metadata", () => {
    act(() => {
      root.render(
        <ProjectLinks
          website="https://theinterfold.io"
          xHandle="@TheInterfold"
          chain="base"
          contractAddress="0xE172e9B6cfBeeB5593bDcE3f077356FDb33af904"
          links={[
            { url: "https://github.com/InterfoldHQ" },
            { url: "https://discord.gg/interfold" },
            { label: "Docs", url: "https://theinterfold.io/documentation" },
            { url: "https://t.me/theinterfold" },
          ]}
        />,
      );
    });

    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Official project links");
    expect(container.querySelector(".project-identity-primary")?.textContent).toBe("theinterfold.io");
    expect([...container.querySelectorAll(".project-identity-resource")].map((link) => link.textContent)).toEqual([
      "X",
      "Telegram",
      "Docs",
      "Discord",
      "GitHub",
      "Dexscreener",
    ]);
    expect(container.querySelector<HTMLAnchorElement>('[href^="https://dexscreener.com/search"]')?.href)
      .toBe("https://dexscreener.com/search?q=0xE172e9B6cfBeeB5593bDcE3f077356FDb33af904");
    expect(container.querySelector(".project-identity-chain")?.textContent).toBe("Base");
    expect(container.querySelector(".project-identity-contract-button")?.textContent).toBe("0xE172…f904");
  });

  it("collapses the project and contract groups when only community links exist", () => {
    act(() => {
      root.render(<ProjectLinks links={[{ url: "https://t.me/argus" }]} />);
    });

    expect(container.querySelector(".project-identity-primary")).toBeNull();
    expect(container.querySelector(".project-identity-contract")).toBeNull();
    expect(container.querySelector(".project-identity-resource")?.textContent).toBe("Telegram");
  });

  it("does not show Dexscreener when no token contract is bound", () => {
    act(() => {
      root.render(<ProjectLinks website="https://argus.example" />);
    });

    expect(container.textContent).not.toContain("Dexscreener");
    expect(container.querySelector('[href*="dexscreener.com"]')).toBeNull();
  });
});
