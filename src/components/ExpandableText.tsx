import { useMemo, useState } from "react";

export function ExpandableText({
  text,
  className = "",
  collapsedLength = 280,
}: {
  text: string;
  className?: string;
  collapsedLength?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = text.length > collapsedLength;
  const collapsed = useMemo(() => {
    if (!canCollapse) return text;
    return `${text.slice(0, collapsedLength).replace(/\s+\S*$/, "").trim()}…`;
  }, [canCollapse, collapsedLength, text]);

  return (
    <div className={className}>
      <p>{expanded ? text : collapsed}</p>
      {canCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1.5 text-[12px] font-medium text-signal-lift underline-offset-2 hover:underline"
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      )}
    </div>
  );
}
