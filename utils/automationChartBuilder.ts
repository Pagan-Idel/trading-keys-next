import { determineSwingPoints } from "./swingLabeler";
import type { StrategyCandle } from "./goldilocksStrategy";
import {
  PI_AUTOMATION_CHART_SCHEMA_VERSION,
  type AutomationChartSource,
  type AutomationSwingMarker,
} from "./automationChartContract";

export const buildAutomationChartSource = (strategyRunUid: string): AutomationChartSource => ({
  authority: "pi-automation-worker",
  schemaVersion: PI_AUTOMATION_CHART_SCHEMA_VERSION,
  strategyRunUid,
});

export const buildAutomationSwingMarkers = (
  candles: StrategyCandle[],
): AutomationSwingMarker[] => determineSwingPoints(
  candles.map((candle, candleIndex) => ({
    ...candle,
    time: new Date(candle.time * 1_000).toISOString(),
    candleIndex,
  })),
).filter((swing) => ["HH", "HL", "LH", "LL"].includes(swing.swing))
  .map((swing) => ({
    swing: swing.swing as AutomationSwingMarker["swing"],
    price: swing.price,
    candleIndex: swing.candleIndex,
    time: candles[swing.candleIndex]?.time ?? 0,
  }));
