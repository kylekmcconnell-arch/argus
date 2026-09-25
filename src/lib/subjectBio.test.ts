import { expect, it } from "vitest";
import { subjectBioScope } from "./subjectBio";

it("assigns explicit builder credits to the other account, never to the subject", () => {
  const result = subjectBioScope("A privacy protocol. Founder: @alice | Developed by @bob", "@brand");
  expect(result.brandDescription).toBe(true);
  expect(result.creditedHandles).toEqual(["alice", "bob"]);
  expect(result.selfDescription).not.toMatch(/founder|developed/i);
});

it.each(["I build a privacy protocol. CTO: @alice", "Founder of @protocol. Built by @alice", "Building @protocol, a privacy app. Dev: @alice"])("preserves a personal description: %s", bio => {
  expect(subjectBioScope(bio, "@bob").brandDescription).toBe(false);
});

it("does not use the subject's own handle as a separate person or classify from a credit alone", () => {
  expect(subjectBioScope("Privacy protocol. Founder: @brand", "@brand").brandDescription).toBe(false);
  expect(subjectBioScope("Built by @alice", "@brand").brandDescription).toBe(false);
});

it("understands trailing developer credits without turning developer job bios into companies", () => {
  expect(subjectBioScope("Real privacy. Built for trenchers. | dev @alice", "@brand").brandDescription).toBe(true);
  expect(subjectBioScope("Developer @privacyprotocol", "@alice").brandDescription).toBe(false);
});
