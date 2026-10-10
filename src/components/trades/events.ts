/** Broadcast that a trade was edited, so any open preview of it can reload. */
export const TRADE_CHANGED = "ledger:trade-changed";
export const emitTradeChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TRADE_CHANGED));
};
