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
}
export function ledgerAvailable(): boolean;
export function ledgerUpsert(receipt: LedgerReceipt): Promise<boolean>;
export function ledgerRecent(limit?: number): Promise<LedgerReceipt[]>;
export function ledgerByDeployer(deployer: string): Promise<LedgerReceipt[]>;
export function ledgerGet(address: string): Promise<LedgerReceipt | null>;
export function ledgerFlagged(limit?: number): Promise<LedgerReceipt[]>;
