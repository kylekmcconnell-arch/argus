import { useEffect, useRef, useState } from "react";

// Profile-photo authenticity check (/api/pfp-check): Claude vision classifies the
// subject's avatar so a supposedly-real founder fronted by an AI face, a stock
// headshot, a celebrity, or a logo gets flagged. Auto-runs on the report.
const LABEL: Record<string, string> = {
  real_candid: "Genuine personal photo",
  studio_or_stock: "Stock / studio headshot",
  ai_generated: "AI-generated face",
  celebrity_or_public_figure: "Celebrity / public figure",
  logo_or_cartoon: "Logo / illustration (no person)",
  no_photo: "No profile photo",
  unclear: "Unclear",
};

export function PfpCheck({ handle, brand }: { handle: string; brand?: boolean }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const r = await fetch(`/api/pfp-check?handle=${encodeURIComponent(handle.replace(/^@/, ""))}`);
        setData(await r.json());
      } catch {
        setData({ note: "Photo check failed." });
      } finally {
        setLoading(false);
      }
    })();
  }, [handle]);

  if (data && data.available === false) return null; // no analyst key configured

  // On a project/brand account, a logo or no-face avatar is expected and is NOT
  // a red flag — only an individual claiming to be a real founder is undercut by
  // a fake/logo face. So neutralise the logo case when the subject is a brand.
  const cls = data?.classification;
  const logoOrNone = cls === "logo_or_cartoon" || cls === "no_photo";
  const brandLogo = !!brand && logoOrNone;
  const flag = data?.flag === true && !brandLogo;
  const label = LABEL[cls] ?? cls ?? "";
  const tells: string[] = data?.tells ?? [];
  const note = brandLogo
    ? "Branded logo or mascot avatar, which is expected for a project or company account rather than an individual. Not treated as an identity flag here."
    : data?.note;

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-3">
        {(data?.imageData || data?.imageUrl) && (
          // Prefer the inline data URI (the exact bytes the classifier saw);
          // remote avatar hosts are flaky and were rendering a blank box.
          <img src={data.imageData ?? data.imageUrl} alt="" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-lg border border-line bg-void object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Profile photo check</div>
          {loading ? (
            <div className="mt-1 text-[12px] text-ink-faint">analyzing the photo…</div>
          ) : (
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium" style={{ color: flag ? "var(--color-avoid)" : "var(--color-ink)" }}>{label}</span>
              {typeof data?.confidence === "number" && <span className="mono text-[10px] text-ink-faint">{Math.round(data.confidence * 100)}%</span>}
              {flag && (
                <span className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: "rgba(240,97,109,.12)", color: "var(--color-avoid)" }}>
                  not a real founder photo
                </span>
              )}
              {brandLogo && (
                <span className="mono rounded border border-line px-1.5 py-0.5 text-[9.5px] text-ink-faint">expected for a project account</span>
              )}
            </div>
          )}
        </div>
      </div>
      {!loading && note && <div className={`mt-2 text-[12px] leading-relaxed ${flag ? "text-avoid" : "text-ink-dim"}`}>{note}</div>}
      {!loading && tells.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tells.map((t, i) => (
            <span key={i} className="mono rounded border border-line px-1.5 py-0.5 text-[9.5px] text-ink-faint">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
