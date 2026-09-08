import { describe, expect, it } from "vitest";
import { officialXProfileHandle } from "./officialXProfile";

describe("official X profile identity", () => {
  it.each(["https://x.com/Project", "https://www.twitter.com/Project/?lang=en"])("accepts an exact profile URL %s", (url) => {
    expect(officialXProfileHandle(url)).toBe("Project");
  });
  it.each(["https://x.com/Project/status/123", "https://x.com/Project/likes", "https://evilx.com/Project", "https://x.com.evil.example/Project", "https://evil.example/x.com/Project", "ftp://x.com/Project", "https://x.com/intent", "https://x.com/i/status/123", "https://x.com/", "not a URL"])("rejects non-profile identity link %s", (url) => {
    expect(officialXProfileHandle(url)).toBeNull();
  });
});
