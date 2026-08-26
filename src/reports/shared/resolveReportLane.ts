import { enigmaReportLane } from "../enigma/reportLane";
import { kyleReportLane } from "../kyle/reportLane";
import type { ReportLaneDefinition, ReportLaneId, ResolvedReportLane } from "./reportLaneTypes";

const definitions: Record<ReportLaneId, ReportLaneDefinition> = {
  kyle: kyleReportLane,
  enigma: enigmaReportLane,
};

const normalizedLane = (value: string | null | undefined): ReportLaneId | null => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "kyle" || normalized === "enigma" ? normalized : null;
};

const stagingLaneForHost = (hostname: string): ReportLaneId | null => {
  const host = hostname.trim().toLowerCase();
  if (host.includes("staging-kyle-reports")) return "kyle";
  if (host.includes("staging-enigma")) return "enigma";
  return null;
};

export function resolveReportLane(input: {
  hostname: string;
  search: string;
  envLane?: string;
  development?: boolean;
}): ResolvedReportLane {
  const hostLane = stagingLaneForHost(input.hostname);
  const envLane = normalizedLane(input.envLane);
  const queryLane = normalizedLane(new URLSearchParams(input.search).get("reportLane"));
  const staging = Boolean(hostLane || input.development || envLane);
  const requestedLane = staging && queryLane ? queryLane : null;
  const id = requestedLane ?? envLane ?? hostLane ?? "kyle";

  return {
    definition: definitions[id],
    staging,
  };
}
