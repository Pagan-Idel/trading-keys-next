import type { GoldilocksZone, StrategyCandle, TradeRunwayCheck } from "./goldilocksStrategy";
import type { GoldilocksApproachPressure } from "./approachPressure";
import type { GoldilocksZoneChartEvidence } from "./goldilocksScanner";

export const PI_AUTOMATION_CHART_SCHEMA_VERSION = 2 as const;

export type AutomationChartSource = {
  authority: "pi-automation-worker";
  schemaVersion: typeof PI_AUTOMATION_CHART_SCHEMA_VERSION;
  strategyRunUid: string;
};

export type AutomationSwingMarker = {
  swing: "HH" | "HL" | "LH" | "LL";
  price: number;
  candleIndex: number;
  time: number;
};

export type AutomationChartSetup = {
  zone: GoldilocksZone;
  touchCandle: StrategyCandle;
  confirmationCandle: StrategyCandle;
  approachPressure?: GoldilocksApproachPressure;
  runway: TradeRunwayCheck;
};

export type AuthoritativeAutomationChartSnapshot = {
  chartSource: AutomationChartSource;
  pair: string;
  scannedAt: string;
  trend: "bullish" | "bearish" | "unknown";
  zoneTimeframe: string;
  confirmationTimeframe: string;
  confirmationMode?: "close-through" | "touch-entry";
  minimumScore?: number;
  zones: GoldilocksZone[];
  zoneEvidence: GoldilocksZoneChartEvidence[];
  candles: Record<string, StrategyCandle[]>;
  swingsByTimeframe: Record<string, AutomationSwingMarker[]>;
  confirmationCount: number;
  setups: AutomationChartSetup[];
  activeTrade?: unknown;
};

export type AuthoritativeAutomationCandlePage = {
  chartSource: AutomationChartSource;
  pair: string;
  timeframe: string;
  candles: StrategyCandle[];
  swings: AutomationSwingMarker[];
  bounds: { startTime: number | null; endTime: number | null; candleCount: number };
  hasOlder: boolean;
  hasNewer: boolean;
};

export const isPiAutomationChartSource = (value: unknown): value is AutomationChartSource => {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<AutomationChartSource>;
  return source.authority === "pi-automation-worker" &&
    source.schemaVersion === PI_AUTOMATION_CHART_SCHEMA_VERSION &&
    typeof source.strategyRunUid === "string" && source.strategyRunUid.length > 0;
};

export const isAuthoritativeAutomationChartSnapshot = (
  value: unknown,
): value is AuthoritativeAutomationChartSnapshot => {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<AuthoritativeAutomationChartSnapshot>;
  return isPiAutomationChartSource(snapshot.chartSource) &&
    typeof snapshot.pair === "string" &&
    Array.isArray(snapshot.zones) &&
    Array.isArray(snapshot.zoneEvidence) &&
    Boolean(snapshot.candles && typeof snapshot.candles === "object") &&
    Boolean(snapshot.swingsByTimeframe && typeof snapshot.swingsByTimeframe === "object") &&
    Array.isArray(snapshot.setups) &&
    snapshot.setups.every((setup) => Boolean(setup?.runway));
};

export const isAuthoritativeAutomationCandlePage = (
  value: unknown,
): value is AuthoritativeAutomationCandlePage => {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<AuthoritativeAutomationCandlePage>;
  return isPiAutomationChartSource(page.chartSource) &&
    typeof page.pair === "string" &&
    typeof page.timeframe === "string" &&
    Array.isArray(page.candles) &&
    Array.isArray(page.swings) &&
    Boolean(page.bounds && typeof page.bounds === "object");
};

export const mergeAutomationSwingMarkers = (...groups: AutomationSwingMarker[][]) =>
  Array.from(
    new Map(groups.flat().map((marker) => [`${marker.time}:${marker.swing}`, marker])).values(),
  ).sort((left, right) => left.time - right.time);
