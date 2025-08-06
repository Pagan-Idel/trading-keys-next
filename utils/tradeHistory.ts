// src/utils/tradeHistory.ts
import fs from 'fs';
import path from 'path';

export type JournalData = {
  swingA: any;
  swingB: any;
  direction: "BUY" | "SELL";
  range: number;
  rrZone: {
    low: number;
    high: number;
  };
  spread: {
    bid: string;
    ask: string;
    raw: number;
    buffer: number;
    pipSize: number;
  };
  tf: string;
  timestamp: string;
};

type TradeRecord = {
  tradeId: string;
  pair: string;
  entry: number;
  sl: number;
  tp: number;
  orderSide: "BUY" | "SELL";
  journalData: JournalData;
  outcome: "WIN" | "LOSS";
  closedAt: string;
  realizedPL?: string;
};

const JOURNAL_PATH = path.resolve("data", "trade-journal.json");

export async function saveTradeRecord(
  tradeId: string,
  pair: string,
  entry: number,
  sl: number,
  tp: number,
  orderSide: "BUY" | "SELL",
  journalData: JournalData,
  outcome: "WIN" | "LOSS",
  realizedPL?: string
) {
  // Adjust outcome if realizedPL is available
  if (realizedPL !== undefined) {
    const numericPL = parseFloat(realizedPL);
    if (!isNaN(numericPL)) {
      outcome = numericPL > 0 ? "WIN" : "LOSS";
    }
  }

  const record: TradeRecord = {
    tradeId,
    pair,
    entry,
    sl,
    tp,
    orderSide,
    journalData,
    outcome,
    closedAt: new Date().toISOString(),
    realizedPL,
  };

  let existing: TradeRecord[] = [];
  try {
    if (fs.existsSync(JOURNAL_PATH)) {
      const content = fs.readFileSync(JOURNAL_PATH, "utf-8").trim();
      if (content) {
        try {
          existing = JSON.parse(content);
        } catch (jsonErr) {
          console.error("❌ Invalid JSON in trade-journal.json — resetting file.", jsonErr);
          existing = [];
        }
      }
    }
  } catch (e) {
    console.error("⚠️ Failed to read existing journal:", e);
  }


  existing.push(record);

  try {
    fs.mkdirSync(path.dirname(JOURNAL_PATH), { recursive: true });
    fs.writeFileSync(JOURNAL_PATH, JSON.stringify(existing, null, 2));
  } catch (e) {
    console.error("❌ Failed to write trade journal:", e);
  }
}
