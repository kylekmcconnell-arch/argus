import { useEffect, useRef, useState } from "react";

// Legacy/current-intelligence profile-photo integrity screen. Fresh reports use
// the frozen core result; this panel is only an explicitly separate overlay.
const LABEL: Record<string, string> = {
  real_candid: "Visually plausible personal photo",
  studio_or_stock: "Studio or stock-like image",
  ai_generated: "AI-generated image lead",
  celebrity_or_public_figure: "Public-figure image lead",
  logo_or_cartoon: "Logo or illustration",
  no_photo: "No profile photo",
  unclear: "Unclear",
};

interface PhotoScreenData {
  available: boolean;
  imageData?: string;
  imageUrl?: string;
  classification?: string;
  confidence?: number;
  flag?: boolean;
  tells: string[];
  note?: string;
}

function photoScreenData(value: unknown): PhotoScreenData {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const classification = typeof raw.classification === "string" && raw.classification in LABEL
    ? raw.classification
    : undefined;
  const available = raw.available === true && classification !== undefined;
  const tells = Array.isArray(raw.tells)
    ? raw.tells.filter((tell): tell is string => typeof tell === "string")
    : [];
  return {
    available,
    ...(typeof raw.imageData === "string" ? { imageData: raw.imageData } : {}),
    ...(typeof raw.imageUrl === "string" ? { imageUrl: raw.imageUrl } : {}),
    ...(classification ? { classification } : {}),
    ...(typeof raw.confidence === "number" && Number.isFinite(raw.confidence) && raw.confidence >= 0 && raw.confidence <= 1 ? { confidence: raw.confidence } : {}),
    ...(typeof raw.flag === "boolean" ? { flag: raw.flag } : {}),
    tells,
    note: available
      ? typeof raw.note === "string" ? raw.note : undefined
      : raw.available === false && typeof raw.note === "string"
        ? raw.note
        : "Profile-photo integrity provider returned no usable conclusion.",
  };
}

export function PfpCheck({ handle, brand, panelCostToken }: { handle: string; brand?: boolean; panelCostToken?: string }) {
  const [data, setData] = useState<PhotoScreenData | null>(null);
  const [loading, setLoading] = useState(true);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const params = new URLSearchParams({ handle: handle.replace(/^@/, "") });
        const r = await fetch(`/api/pfp-check?${params}`, panelCostToken
          ? { headers: { "x-argus-panel-token": panelCostToken } }
          : undefined);
        const rawBody = await r.json().catch(() => ({})) as unknown;
        const body = photoScreenData(rawBody);
        const errorBody = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
          ? rawBody as Record<string, unknown>
          : {};
        const failureNote = typeof errorBody.message === "string"
          ? errorBody.message
          : typeof errorBody.error === "string"
            ? errorBody.error
            : `Photo screen unavailable (${r.status}).`;
        setData(r.ok ? body : { available: false, tells: [], note: failureNote });
      } catch {
        setData({ available: false, tells: [], note: "Profile-photo integrity screen failed; no conclusion was recorded." });
      } finally {
        setLoading(false);
      }
    })();
  }, [handle, panelCostToken]);

  // On a project/brand account, a logo or no-face avatar is expected and is NOT
  // a red flag — only an individual claiming to be a real founder is undercut by
  // a fake/logo face. So neutralise the logo case when the subject is a brand.
  const available = data?.available === true;
  const cls = data?.classification;
  const logoOrNone = cls === "logo_or_cartoon" || cls === "no_photo";
  const brandLogo = available && !!brand && logoOrNone;
  const flag = available && data?.flag === true && !brandLogo;
  const label = available && cls ? LABEL[cls] ?? cls : "";
  const tells = available ? data?.tells ?? [] : [];
  const note = brandLogo
    ? "Branded logo or mascot avatar, which is expected for a project or company account rather than an individual. Not treated as an identity flag here."
    : data?.note;

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-3">
        {available && (data?.imageData || data?.imageUrl) && (
          // Prefer the inline data URI (the exact bytes the classifier saw);
          // remote avatar hosts are flaky and were rendering a blank box.
          <img src={data.imageData ?? data.imageUrl} alt="" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-lg border border-line bg-void object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Profile-photo integrity screen</div>
          {loading ? (
            <div className="mt-1 text-[12px] text-ink-faint">analyzing the photo…</div>
          ) : (
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium" style={{ color: flag ? "var(--color-avoid)" : "var(--color-ink)" }}>{label}</span>
              {available && typeof data?.confidence === "number" && <span className="mono text-[10px] text-ink-faint">{Math.round(data.confidence * 100)}%</span>}
              {data?.available === false && (
                <span className="mono rounded border border-line px-1.5 py-0.5 text-[9.5px] text-ink-faint">unavailable · no conclusion</span>
              )}
              {flag && (
                <span className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: "rgba(240,97,109,.12)", color: "var(--color-avoid)" }}>
                  review lead · verify independently
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
