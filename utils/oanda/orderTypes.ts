export const TYPE = {
  MARKET: "MARKET",
  LIMIT: "LIMIT",
  STOP: "STOP",
  MARKET_IF_TOUCHED: "MARKET_IF_TOUCHED",
  TAKE_PROFIT: "TAKE_PROFIT",
  STOP_LOSS: "STOP_LOSS",
  GUARANTEED_STOP_LOSS: "GUARANTEED_STOP_LOSS",
  TRAILING_STOP_LOSS: "TRAILING_STOP_LOSS",
  FIXED_PRICE: "FIXED_PRICE",
} as const;

export const ACTION = {
  SELL: "SELL",
  BUY: "BUY",
  SLatEntry: "SLatEntry",
  MoveSL: "MoveSL",
  MoveTP: "MoveTP",
  PartialClose50: "PartialClose50",
  PartialClose25: "PartialClose25",
  PartialClose: "PartialClose",
  CLOSE: "Close",
  UP: "Up",
  DOWN: "Down",
} as const;

export type ACTION = (typeof ACTION)[keyof typeof ACTION];
