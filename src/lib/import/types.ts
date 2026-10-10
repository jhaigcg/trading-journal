export type DealKind = "BUY" | "SELL" | "BALANCE" | "OTHER";
export type EntryKind = "IN" | "OUT" | "INOUT" | "OUT_BY" | null;

/** Broker-agnostic deal. Costs keep the broker's sign (commission/swap are negative when they cost money). */
export interface RawDeal {
  id: string;
  positionId: string | null;
  kind: DealKind;
  entry: EntryKind;
  symbol: string | null;
  time: Date; // UTC
  volume: number;
  price: number;
  commission: number;
  swap: number;
  profit: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  comment?: string | null;
  magic?: number | null;
  /** true for a synthetic IN deal built from a currently open position (profit = floating P&L) */
  openPosition?: boolean;
}

export interface AccountSnapshot {
  balance: number;
  equity: number;
  currency: string;
  broker?: string;
  server?: string;
  login?: string;
}

export type ConnectionState = "CONNECTED" | "CONNECTING" | "DISCONNECTED" | "UNDEPLOYED" | "ERROR";

/** Implemented by MetaApi today; any other source (file import, another gateway) can plug in later. */
export interface ImportAdapter {
  readonly id: string;
  connectionState(): Promise<{ state: ConnectionState; message?: string }>;
  /** Closed-trade history in [from, to). Implementations paginate internally. */
  fetchDeals(from: Date, to: Date): Promise<RawDeal[]>;
  /** All deals of one position (used to complete positions that straddle a window). */
  fetchPositionDeals(positionId: string): Promise<RawDeal[]>;
  fetchOpenPositions(): Promise<RawDeal[]>;
  fetchAccount(): Promise<AccountSnapshot>;
}
