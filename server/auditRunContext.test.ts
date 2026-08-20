import { describe, expect, it } from "vitest";
import {
  auditMemo,
  currentAuditScanId,
  currentSubjectCachePolicy,
  subjectCacheAccess,
  withAuditRunContext,
} from "./auditRunContext";

describe("audit run context", () => {
  it("keeps the public default backward-compatible", () => {
    expect(currentAuditScanId()).toBeUndefined();
    expect(currentSubjectCachePolicy()).toBe("reuse");
    expect(subjectCacheAccess()).toEqual({ read: true, write: true });
  });

  it("makes a full rescan skip subject-cache reads but refresh successful writes", () => {
    withAuditRunContext({ fresh: true, scanId: "fresh-scan" }, () => {
      expect(currentAuditScanId()).toBe("fresh-scan");
      expect(currentSubjectCachePolicy()).toBe("refresh");
      expect(subjectCacheAccess()).toEqual({ read: false, write: true });
      expect(subjectCacheAccess(true)).toEqual({ read: false, write: false });
    });
  });

  it("isolates coalescing memos between overlapping scans", async () => {
    const results = await Promise.all([
      withAuditRunContext({ scanId: "scan-a" }, async () => {
        const memo = auditMemo<number>("provider");
        memo.set("same-key", 1);
        await Promise.resolve();
        return { own: memo.get("same-key"), foreign: memo.get("scan-b") };
      }),
      withAuditRunContext({ fresh: true, scanId: "scan-b" }, async () => {
        const memo = auditMemo<number>("provider");
        memo.set("same-key", 2);
        memo.set("scan-b", 3);
        await Promise.resolve();
        return { own: memo.get("same-key"), policy: currentSubjectCachePolicy() };
      }),
    ]);

    expect(results).toEqual([
      { own: 1, foreign: undefined },
      { own: 2, policy: "refresh" },
    ]);
  });
});
