export interface PanelCostLine { provider: string; op: string; calls: number; usd: number; meta?: string }
export function cacheGetJson<T>(key: string): Promise<T | null>;
export function cacheSetJson(key: string, value: unknown): Promise<void>;
export function attachPanelCost(organizationId: string, reportVersionId: string | undefined, line: PanelCostLine): Promise<void>;
export function grokUsd(usage: { input_tokens?: number; output_tokens?: number } | undefined, toolCalls?: number): number;
export function claudeUsd(usage: { input_tokens?: number; output_tokens?: number } | undefined): number;
