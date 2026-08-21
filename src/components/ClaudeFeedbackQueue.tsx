import { useEffect, useState } from "react";

interface FeedbackItem {
  id: string;
  status: "todo" | "planned" | "in_progress" | "done" | "wont_do";
  priority: "low" | "normal" | "high" | "urgent";
  route: string;
  body: string;
  createdAt?: string;
  created_at?: string;
}

const statusLabel: Record<FeedbackItem["status"], string> = {
  todo: "To do",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  wont_do: "Won’t do",
};

export function ClaudeFeedbackQueue() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const response = await fetch("/api/feedback", { signal: AbortSignal.timeout(10_000) });
      const body = await response.json() as { items?: FeedbackItem[]; message?: string };
      if (!response.ok) throw new Error(body.message || "Feedback queue unavailable.");
      setItems(body.items || []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Feedback queue unavailable.");
    }
  };

  useEffect(() => { void load(); }, []);

  const update = async (item: FeedbackItem, patch: Partial<Pick<FeedbackItem, "status" | "priority">>) => {
    const previous = items;
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...patch } : entry));
    try {
      const response = await fetch("/api/feedback", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, ...patch }),
      });
      if (!response.ok) throw new Error();
    } catch {
      setItems(previous);
      setError("That feedback item could not be updated.");
    }
  };

  const open = items.filter((item) => item.status !== "done" && item.status !== "wont_do");
  const complete = items.length - open.length;

  return (
    <section className="panel mt-5 overflow-hidden" aria-labelledby="claude-feedback-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div>
          <h2 id="claude-feedback-heading" className="text-[13.5px] font-medium text-ink">Claude feedback queue</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">Test-user feedback captured in context and managed as an owner checklist.</p>
        </div>
        <span className="chip tint-signal">{open.length} open · {complete} closed</span>
      </div>
      {error && <div role="alert" className="border-b border-line px-4 py-2 text-[12px] text-avoid">{error}</div>}
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12px] text-ink-faint">No feedback yet.</div>
      ) : (
        <div>
          {items.map((item) => (
            <article key={item.id} className="border-b border-line px-4 py-3 last:border-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p className={`text-[12.5px] leading-relaxed ${item.status === "done" ? "text-ink-faint line-through" : "text-ink"}`}>{item.body}</p>
                  <p className="mono mt-1 truncate text-[10.5px] text-ink-faint">{item.route}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
                    <input
                      type="checkbox"
                      checked={item.status === "done"}
                      onChange={(event) => void update(item, { status: event.target.checked ? "done" : "todo" })}
                      aria-label={`Mark done: ${item.body.slice(0, 40)}`}
                    />
                    Done
                  </label>
                  <select
                    aria-label={`Priority for feedback: ${item.body.slice(0, 40)}`}
                    value={item.priority}
                    onChange={(event) => void update(item, { priority: event.target.value as FeedbackItem["priority"] })}
                    className="field mono px-2 py-1.5 text-[11px]"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                  <select
                    aria-label={`Status for feedback: ${item.body.slice(0, 40)}`}
                    value={item.status}
                    onChange={(event) => void update(item, { status: event.target.value as FeedbackItem["status"] })}
                    className="field mono px-2 py-1.5 text-[11px]"
                  >
                    {(Object.keys(statusLabel) as FeedbackItem["status"][]).map((status) => (
                      <option key={status} value={status}>{statusLabel[status]}</option>
                    ))}
                  </select>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
