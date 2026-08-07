export type LogicalChartRange = { from: number; to: number };

export const chartViewportCandleKey = (times: number[]) =>
  times.length
    ? `${times.length}:${times[0]}:${times[times.length - 1]}`
    : "empty";

export const canRestoreLogicalChartRange = (
  savedCandleKey: string | null,
  currentCandleKey: string,
  logicalRange: LogicalChartRange | null,
) =>
  savedCandleKey === currentCandleKey &&
  logicalRange !== null &&
  Number.isFinite(logicalRange.from) &&
  Number.isFinite(logicalRange.to) &&
  logicalRange.to > logicalRange.from;

export const autoscalePriceRangeWithZones = (
  base: { minValue: number; maxValue: number },
  zones: Array<{ low: number; high: number }>,
) => {
  const validZones = zones.filter(
    (zone) => Number.isFinite(zone.low) && Number.isFinite(zone.high) && zone.high > zone.low,
  );
  if (!validZones.length) return base;
  const minValue = Math.min(base.minValue, ...validZones.map((zone) => zone.low));
  const maxValue = Math.max(base.maxValue, ...validZones.map((zone) => zone.high));
  const padding = Math.max(
    (maxValue - minValue) * 0.04,
    ...validZones.map((zone) => (zone.high - zone.low) * 0.5),
  );
  return { minValue: minValue - padding, maxValue: maxValue + padding };
};
