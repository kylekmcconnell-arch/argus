import { useEffect, useState } from "react";

interface WaitlistItem {
  user_id: string;
  public_name: string;
  code: string;
  status: string;
  created_at: string;
}

export function WaitlistAdmin() {
  const [items, setItems] = useState<WaitlistItem[]>([]);
  const [error, setError] = useState("");
  const [admitting, setAdmitting] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch("/api/waitlist", { signal: AbortSignal.timeout(10_000) });
      const body = await response.json() as { items?: WaitlistItem[]; message?: string };
      if (!response.ok) throw new Error(body.message || "Waitlist unavailable.");
      setItems(body.items || []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Waitlist unavailable.");
    }
  };

  useEffect(() => { void load(); }, []);

  const admit = async (userId: string) => {
    setAdmitting(userId);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) throw new Error();
      await load();
    } catch {
      setError("That waitlist entry could not be admitted.");
    } finally {
      setAdmitting(null);
    }
  };

  return (
    <section className="panel mt-5 overflow-hidden" aria-labelledby="waitlist-heading">
      <div className="border-b border-line px-4 py-3.5">
        <h2 id="waitlist-heading" className="text-[13.5px] font-medium text-ink">Early-access waitlist</h2>
        <p className="mt-0.5 text-[11px] text-ink-faint">Admit a ranked referrer into the workspace with the 10-credit tester budget.</p>
      </div>
      {error && <div role="alert" className="border-b border-line px-4 py-2 text-[12.5px] text-avoid">{error}</div>}
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-ink-faint">No waitlist entries.</div>
      ) : items.map((item) => (
        <div key={item.user_id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium text-ink">{item.public_name}</div>
            <div className="mono mt-0.5 text-[11px] text-ink-faint">{item.code}</div>
          </div>
          <button
            type="button"
            disabled={admitting === item.user_id}
            onClick={() => void admit(item.user_id)}
            className="btn-primary px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            {admitting === item.user_id ? "Admitting…" : "Admit"}
          </button>
        </div>
      ))}
    </section>
  );
}
