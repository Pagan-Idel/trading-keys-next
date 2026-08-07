import assert from "node:assert/strict";
import test from "node:test";
import {
  autoscalePriceRangeWithZones,
  canRestoreLogicalChartRange,
  chartViewportCandleKey,
} from "../utils/chartViewport.ts";

test("restores the exact logical viewport when a live refresh keeps the same candles", () => {
  const candleKey = chartViewportCandleKey([100, 200, 300]);

  assert.equal(
    canRestoreLogicalChartRange(candleKey, candleKey, {
      from: 17.25,
      to: 63.75,
    }),
    true,
  );
});

test("falls back to the timestamp viewport when candle history changes", () => {
  const previous = chartViewportCandleKey([100, 200, 300]);
  const paginated = chartViewportCandleKey([0, 100, 200, 300]);

  assert.equal(
    canRestoreLogicalChartRange(previous, paginated, {
      from: 17.25,
      to: 63.75,
    }),
    false,
  );
});

test("rejects missing or invalid logical ranges", () => {
  const candleKey = chartViewportCandleKey([100, 200, 300]);

  assert.equal(canRestoreLogicalChartRange(candleKey, candleKey, null), false);
  assert.equal(
    canRestoreLogicalChartRange(candleKey, candleKey, { from: 10, to: 10 }),
    false,
  );
});

test("pads live price scale beyond the nearest demand and supply zones", () => {
  const range = autoscalePriceRangeWithZones(
    { minValue: 100, maxValue: 110 },
    [{ low: 98, high: 99 }, { low: 111, high: 112 }],
  );

  assert.ok(range.minValue < 98);
  assert.ok(range.maxValue > 112);
});
