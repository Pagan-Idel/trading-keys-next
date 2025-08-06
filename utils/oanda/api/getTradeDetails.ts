import fs from "fs";
import path from "path";
import credentials from "../../../credentials.json";
import { logMessage } from "../../logger";
import { getLoginMode } from "../../loginState";

export interface TradeDetail {
  id: string;
  instrument: string;
  realizedPL: string;
  state: string;
  price: string;
}

interface TradeDetailsResponse {
  trades: TradeDetail[];
  lastTransactionID: string;
}

const JOURNAL_PATH = path.resolve("data", "trade-journal.json");

export const getTradeDetailsById = async (
  tradeId: string
): Promise<TradeDetail | null> => {
  const accountType = getLoginMode(); // ✅ use proper login mode

  const hostname = accountType === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";

  const accountId = accountType === "live"
    ? credentials.OANDA_LIVE_ACCOUNT_ID
    : credentials.OANDA_DEMO_ACCOUNT_ID;

  const token = accountType === "live"
    ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
    : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

  const url = `${hostname}/v3/accounts/${accountId}/trades?state=CLOSED`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      logMessage(`❌ Failed to fetch trade details for ${tradeId}`, { status: res.status }, {
        fileName: "getTradeDetails",
      });
      return null;
    }

    const json = (await res.json()) as TradeDetailsResponse;

    logMessage(`📦 Full CLOSED trades response`, json, {
      level: "debug",
      fileName: "getTradeDetails",
    });

    const trade = json.trades.find((t) => t.id === tradeId);

    if (trade) {
      logMessage(`✅ Found trade ID ${tradeId}`, trade, {
        fileName: "getTradeDetails",
      });
    } else {
      logMessage(`⚠️ Trade with ID ${tradeId} not found in CLOSED trades list.`, undefined, {
        fileName: "getTradeDetails",
      });
    }

    // 📝 Update any missing realizedPL in local journal
    try {
      if (fs.existsSync(JOURNAL_PATH)) {
        const content = fs.readFileSync(JOURNAL_PATH, "utf-8").trim();

        if (!content) {
          logMessage("⚠️ trade-journal.json is empty — skipping update", undefined, {
            fileName: "getTradeDetails",
          });
        } else {
          const records = JSON.parse(content);
          let updated = false;

          for (const record of records) {
            if (!record.realizedPL && record.tradeId) {
              const match = json.trades.find((t) => t.id === record.tradeId);
              if (match?.realizedPL) {
                record.realizedPL = match.realizedPL;
                updated = true;
                logMessage(`🟢 Updated realizedPL for trade ${record.tradeId}: ${match.realizedPL}`, undefined, {
                  fileName: "getTradeDetails",
                });
              }
            }
          }

          if (updated) {
            fs.writeFileSync(JOURNAL_PATH, JSON.stringify(records, null, 2));
          }
        }
      }
    } catch (e) {
      console.error("⚠️ Failed to update local trade journal:", e);
    }

    return trade ?? null;
  } catch (err) {
    logMessage(`❌ Exception in getTradeDetailsById`, err, {
      fileName: "getTradeDetails",
    });
    return null;
  }
};
