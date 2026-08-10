export interface LedgerReceipt {
  address: string;
  chain: string;
  symbol: string;
  verdict: "SAFE" | "CAUTION" | "DANGER" | "RUG" | "UNKNOWN";
  risk: number;
  flaggedAt: number;
  liqThen: number;
  liqNow?: number;
  priceDropPct?: number;
  status?: "alive" | "bleeding" | "dead";
  checkedAt?: number;
  deployer?: string | null;
  codeVerified?: boolean;
  flagCount?: number;
  codeFingerprint?: string | null;
}
export interface ThreatAlert {
  address: string;
  chain: string;
  symbol: string;
  type: "liquidity-collapse" | "confirmed-dead";
  wasVerdict: string; // the verdict we had recorded
  liqThen: number;
  liqNow: number;
  priceDropPct: number;
  at: number;
}
export function ledgerAvailable(): boolean;
export function ledgerUpsert(receipt: LedgerReceipt): Promise<boolean>;
export function ledgerRecent(limit?: number): Promise<LedgerReceipt[]>;
export function ledgerByDeployer(deployer: string): Promise<LedgerReceipt[]>;
export function ledgerGet(address: string): Promise<LedgerReceipt | null>;
export function ledgerFlagged(limit?: number): Promise<LedgerReceipt[]>;
export function ledgerRatedOk(limit?: number): Promise<LedgerReceipt[]>;
export function ledgerByFingerprint(fingerprint: string): Promise<LedgerReceipt[]>;
export function ledgerRecordAlert(alert: ThreatAlert): Promise<boolean>;
export function ledgerRecentAlerts(limit?: number): Promise<ThreatAlert[]>;
export function ledgerGetAlert(address: string): Promise<ThreatAlert | null>;
