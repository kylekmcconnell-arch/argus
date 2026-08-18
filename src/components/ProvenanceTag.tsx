import type { ReactNode } from "react";
import { provenanceLabel, provenanceTint, type ProvenanceState } from "../lib/provenance";

/** The ONE origin-of-value badge (DESIGN.md 2.1). Renders any value's provenance tier. */
export function ProvenanceTag({ state, label, icon, className = "" }: {
  state: ProvenanceState;
  /** Override the default tier label (e.g. a status-specific phrase). */
  label?: string;
  /** An additional leading icon, alongside the dot mark (e.g. CheckCircle). */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`chip provenance-tag ${provenanceTint(state)} ${state.contested ? "mark-contested" : ""} ${icon ? "gap-1" : ""} normal-case tracking-normal ${className}`}
    >
      {icon}
      {label ?? provenanceLabel(state)}
    </span>
  );
}
