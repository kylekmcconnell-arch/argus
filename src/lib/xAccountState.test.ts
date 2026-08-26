import { describe, expect, it } from "vitest";
import {
  classifyPublicXAccountPage,
  shouldAnnounceOfficialXAccountStatus,
  xAccountIdentityEstablished,
} from "./xAccountState";

describe("public X account probe classification", () => {
  it("records suspension only when X's page says Account suspended", () => {
    expect(classifyPublicXAccountPage("<h2>Account suspended</h2>")).toBe("suspended");
    expect(classifyPublicXAccountPage(`<script>window.__DATA__={"unavailable_reason":"Suspended"}</script>`))
      .toBe("temporarily_unavailable");
  });

  it("records a missing account only when X's page says it does not exist", () => {
    expect(classifyPublicXAccountPage("<span>This account doesn’t exist</span>")).toBe("unavailable");
    expect(classifyPublicXAccountPage("This account does not exist")).toBe("unavailable");
    expect(classifyPublicXAccountPage("Account does not exist")).toBe("unavailable");
  });

  it("classifies login walls and empty shells as temporarily unavailable", () => {
    expect(classifyPublicXAccountPage("<html><body>Something went wrong. Try reloading.</body></html>"))
      .toBe("temporarily_unavailable");
    expect(classifyPublicXAccountPage("")).toBe("temporarily_unavailable");
    expect(classifyPublicXAccountPage(`{"unavailable_reason":"Unavailable"}`))
      .toBe("temporarily_unavailable");
  });

  it("does not announce a probe failure when identity is already established", () => {
    expect(xAccountIdentityEstablished({ identity_binding: "independent_exact_handle" })).toBe(true);
    expect(xAccountIdentityEstablished({ followers: "12.4K" })).toBe(true);
    expect(xAccountIdentityEstablished({ website: "https://example.com" })).toBe(true);
    expect(xAccountIdentityEstablished({ profile_collection_state: "resolved" })).toBe(true);
    expect(xAccountIdentityEstablished({})).toBe(false);

    expect(shouldAnnounceOfficialXAccountStatus({
      accountStatus: "temporarily_unavailable",
      identityEstablished: false,
    })).toBe(false);
    expect(shouldAnnounceOfficialXAccountStatus({
      accountStatus: "unavailable",
      identityEstablished: true,
    })).toBe(false);
    expect(shouldAnnounceOfficialXAccountStatus({
      accountStatus: "unavailable",
      identityEstablished: false,
    })).toBe(true);
    expect(shouldAnnounceOfficialXAccountStatus({
      accountStatus: "suspended",
      identityEstablished: true,
    })).toBe(true);
  });

  it("lets a frozen unavailable notice stay on an old saved report", () => {
    expect(shouldAnnounceOfficialXAccountStatus({
      accountStatus: "unavailable",
      identityEstablished: false,
    })).toBe(true);
  });
});
