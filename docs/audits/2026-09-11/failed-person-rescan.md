# A failed person rescan showed the previously opened report as its result

Issue #367. Reproduced against `461ed848` and repaired on `codex/issue-367-person-rescan-failure`.

## What was wrong

`onLiveError` in `src/App.tsx` opened with:

```ts
const cached = resultCache.current.get(cacheKey(ref, "person"));
if (cached) { showCached(ref, cached); return; }
```

`resultCache` is the session cache of opened reports. It is filled by `onOpenRecent` and never cleared when a new audit starts, so the entry it returns is whatever report the user last opened — not anything this run produced. Every person-run failure path ended here: credit exhaustion, provider timeouts, stream drops. The user saw their stored report reappear with no notice, which reads as a successful rescan.

The investigation path already handled this correctly (`onInvestigationError` surfaces the failure), and `App.routing.test.tsx` never fired `LiveRun.onError`, so nothing caught the person path.

## The distinction that matters

A dropped SSE stream over a completed server-side audit is genuinely recoverable — the server persists the finished audit even when the connection dies, and the poll below the cache shortcut exists for exactly that. What was missing is the test of whether the stored report belongs to the run that just failed.

Report versions are monotonic per case, so version identity answers it exactly, with no dependence on client or server clocks:

- `personRunBaseline` records the immutable version this client already held for the handle at the moment `startPersonAudit` is called.
- On failure, the poll accepts a stored report only when its `version` is greater than the baseline and its `reportVersionId` differs. That is a version this run produced.
- A stored report at or below the baseline is the report the rescan was meant to replace. It is not shown as the run's result.
- With no baseline at all (a first scan, nothing cached for the handle) any stored version still counts as recovery. That is the original stream-drop case, where there is no earlier report to confuse it with.

The cache shortcut is gone entirely. The session cache is not evidence about a run; only the server can say whether the run produced anything.

## What the user sees now

A failed run that produced nothing routes to a `rescan-failed` notice: "The scan didn't finish", the concrete failure reason from `getRun(ref)?.error`, and a primary "Run the scan again". When a stored report exists it is offered explicitly as "Open last saved report", with the copy saying plainly that it is the earlier scan's result and not this one's. The stored outcome is still reconciled into the audit log, because the active stored version remains the server truth for the case — that bookkeeping never depended on which run failed.

## Regression coverage

`src/App.routing.test.tsx` gains the `LiveRun.onError` hook the audit noted was missing, plus:

- a failed rescan over stored version 4 that keeps the failure visible, shows the collector's reason, and offers the saved report only as an explicit secondary action;
- a failed stream whose run did persist version 5, which still recovers into the report.

Both run the four-attempt recovery poll under fake timers. Reverting the version guard fails the first test and leaves the second passing, so the fixture is bound to the defect rather than to the surrounding flow.
