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
});
