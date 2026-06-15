// Dynamic OG image for share links. Renders the ARGUS verdict card so a pasted
// link unfurls in Telegram / X / Discord. Edge runtime via @vercel/og.
import React from "react";
import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const VCOLOR: Record<string, string> = {
  PASS: "#16a34a",
  CAUTION: "#d97706",
  FAIL: "#ea580c",
  AVOID: "#dc2626",
  UNVERIFIABLE_IDENTITY: "#7c3aed",
};

export default function handler(req: Request) {
  const u = new URL(req.url);
  const p = u.searchParams;
  const kind = p.get("k") || "token"; // token | person
  const title = (p.get("t") || "ARGUS").slice(0, 28);
  const sub = (p.get("s") || "").slice(0, 90);
  const verdict = (p.get("v") || "PASS").toUpperCase();
  const score = p.get("sc") || "";
  const chip = p.get("c") || (kind === "token" ? "TOKEN AUDIT" : "PRINCIPAL AUDIT");
  const color = VCOLOR[verdict] || "#38e1c4";

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          background: "#fafafa",
          padding: "64px",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", color: "#09090b" }}>
          <div style={{ display: "flex", width: "34px", height: "34px", borderRadius: "8px", background: "#09090b", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "13px", height: "13px", borderRadius: "9999px", background: "#d64a9e" }} />
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "4px" }}>ARGUS</div>
          <div style={{ fontSize: "16px", color: "#a1a1aa", letterSpacing: "2px", marginLeft: "6px" }}>{chip}</div>
        </div>

        {/* subject */}
        <div style={{ display: "flex", marginTop: "70px", fontSize: "76px", fontWeight: 600, color: "#09090b", letterSpacing: "-2px" }}>
          {kind === "token" ? "$" + title.replace(/^\$/, "") : title}
        </div>
        <div style={{ display: "flex", marginTop: "18px", fontSize: "28px", lineHeight: 1.35, color: "#52525b", maxWidth: "760px" }}>
          {sub}
        </div>

        {/* verdict block bottom */}
        <div style={{ display: "flex", alignItems: "center", gap: "28px", position: "absolute", left: "64px", bottom: "64px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: "20px", letterSpacing: "4px", color: "#a1a1aa" }}>VERDICT</div>
            <div style={{ display: "flex", fontSize: "92px", fontWeight: 800, color, lineHeight: 1, letterSpacing: "-2px" }}>{verdict.replace("_IDENTITY", "")}</div>
          </div>
          {score && (
            <div style={{ display: "flex", alignItems: "baseline", border: `3px solid ${color}`, borderRadius: "9999px", padding: "16px 30px", color }}>
              <div style={{ fontSize: "56px", fontWeight: 800 }}>{score}</div>
              <div style={{ fontSize: "24px", marginLeft: "4px", color: "#a1a1aa" }}>/100</div>
            </div>
          )}
        </div>

        <div style={{ position: "absolute", right: "64px", bottom: "70px", fontSize: "22px", color: "#a1a1aa" }}>argus-one-flax.vercel.app</div>
        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: "10px", background: color }} />
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
