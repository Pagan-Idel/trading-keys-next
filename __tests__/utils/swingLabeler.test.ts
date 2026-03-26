import {
  getATR,
  getAverageRange,
  isStrongBody,
  safePush,
  dedupeSwingLabels,
  isPullback,
  determineSwingPoints,
  type Candle,
  type SwingResult,
} from '../../utils/swingLabeler';

// Helper to build a candle with predictable time values
function candle(
  candleIndex: number,
  open: number,
  high: number,
  low: number,
  close: number
): Candle {
  return {
    candleIndex,
    time: new Date(candleIndex * 60_000).toISOString(),
    open,
    high,
    low,
    close,
  };
}

function swing(
  candleIndex: number,
  swingType: SwingResult['swing'],
  price: number
): SwingResult {
  return {
    candleIndex,
    swing: swingType,
    price,
    time: new Date(candleIndex * 60_000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// getATR
// ---------------------------------------------------------------------------
describe('getATR', () => {
  it('returns 0 for fewer than 2 candles', () => {
    expect(getATR([])).toBe(0);
    expect(getATR([candle(0, 1, 1.1, 0.9, 1.0)])).toBe(0);
  });

  it('computes single true range correctly', () => {
    // Two candles: TR = max(high-low, |high-prevClose|, |low-prevClose|)
    // prev: close=1.000; curr: high=1.020, low=0.990
    // highLow     = 0.030
    // highPrevClose = |1.020 - 1.000| = 0.020
    // lowPrevClose  = |0.990 - 1.000| = 0.010
    // TR = 0.030
    const candles = [
      candle(0, 1.0, 1.0, 1.0, 1.0),
      candle(1, 1.0, 1.02, 0.99, 1.01),
    ];
    expect(getATR(candles, 14)).toBeCloseTo(0.03, 5);
  });

  it('uses only the last `period` true ranges', () => {
    // Build 20 candles with a consistent range of 0.01 (high=1.005, low=0.995)
    // so TR = max(0.01, 0.005, 0.005) = 0.01 for every pair
    const candles: Candle[] = [candle(0, 1.0, 1.005, 0.995, 1.0)];
    for (let i = 1; i <= 19; i++) {
      candles.push(candle(i, 1.0, 1.005, 0.995, 1.0));
    }
    // All TRs are ~0.01; period=5 should yield ~0.01
    const atr = getATR(candles, 5);
    expect(atr).toBeCloseTo(0.01, 4);
  });

  it('accounts for gap (high vs prevClose)', () => {
    // Gap up: prev close=1.0, curr high=1.05, curr low=1.02
    // TR = max(0.03, 0.05, 0.02) = 0.05
    const candles = [
      candle(0, 1.0, 1.0, 1.0, 1.0),
      candle(1, 1.02, 1.05, 1.02, 1.04),
    ];
    expect(getATR(candles, 14)).toBeCloseTo(0.05, 5);
  });
});

// ---------------------------------------------------------------------------
// getAverageRange
// ---------------------------------------------------------------------------
describe('getAverageRange', () => {
  it('computes average of high-low ranges', () => {
    const candles = [
      candle(0, 1.0, 1.02, 1.00, 1.01), // range 0.02
      candle(1, 1.0, 1.04, 1.01, 1.02), // range 0.03
      candle(2, 1.0, 1.05, 1.03, 1.04), // range 0.02
    ];
    // average = (0.02 + 0.03 + 0.02) / 3 = 0.02333...
    expect(getAverageRange(candles)).toBeCloseTo(0.0233, 3);
  });

  it('returns the range for a single candle', () => {
    const candles = [candle(0, 1.0, 1.05, 0.95, 1.0)];
    expect(getAverageRange(candles)).toBeCloseTo(0.1, 5);
  });
});

// ---------------------------------------------------------------------------
// isStrongBody
// ---------------------------------------------------------------------------
describe('isStrongBody', () => {
  it('returns true for a large-bodied candle well above ATR', () => {
    // Build 14 prior candles with small ranges (~0.002) so ATR is small
    const prevCandles: Candle[] = [];
    for (let i = 0; i < 14; i++) {
      prevCandles.push(candle(i, 1.0, 1.001, 0.999, 1.0));
    }
    // The candle under test has a large body and range relative to the ATR
    const strongCandle = candle(14, 1.0, 1.02, 0.99, 1.018);
    // range=0.03, body=0.018; ATR≈0.002 → minRange=0.001; body/range=0.6 > 0.5
    expect(isStrongBody(strongCandle, prevCandles)).toBe(true);
  });

  it('returns false for a doji (tiny body relative to range)', () => {
    const prevCandles: Candle[] = [];
    for (let i = 0; i < 14; i++) {
      prevCandles.push(candle(i, 1.0, 1.01, 0.99, 1.0));
    }
    // Doji: wide range but open ≈ close
    const dojiCandle = candle(14, 1.0, 1.02, 0.98, 1.001);
    // range=0.04, body=0.001, body/range=0.025 < 0.50 → not strong
    expect(isStrongBody(dojiCandle, prevCandles)).toBe(false);
  });

  it('returns false when range is below ATR threshold', () => {
    const prevCandles: Candle[] = [];
    for (let i = 0; i < 14; i++) {
      prevCandles.push(candle(i, 1.0, 1.02, 0.98, 1.0)); // large ATR ~0.04
    }
    // Tiny candle: range=0.001, well below 0.5 * ATR
    const tinyCandle = candle(14, 1.0, 1.0005, 0.9995, 1.0003);
    expect(isStrongBody(tinyCandle, prevCandles)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// safePush
// ---------------------------------------------------------------------------
describe('safePush', () => {
  it('pushes a new label onto an empty array', () => {
    const labels: SwingResult[] = [];
    safePush(labels, swing(1, 'H', 1.05));
    expect(labels).toHaveLength(1);
    expect(labels[0].swing).toBe('H');
  });

  it('skips if the last label has the same swing type and price', () => {
    const labels = [swing(1, 'HH', 1.05)];
    safePush(labels, swing(2, 'HH', 1.05));
    expect(labels).toHaveLength(1);
  });

  it('allows a new HH with a higher price', () => {
    const labels = [swing(1, 'HH', 1.05)];
    safePush(labels, swing(2, 'HH', 1.06));
    expect(labels).toHaveLength(2);
  });

  it('prevents a second consecutive BOS', () => {
    const labels = [swing(1, 'BOS', 1.05)];
    safePush(labels, swing(2, 'BOS', 1.06));
    expect(labels).toHaveLength(1);
  });

  it('prevents L or H followed by a label with the same price', () => {
    const labels = [swing(1, 'L', 1.00)];
    safePush(labels, swing(2, 'HL', 1.00)); // same price as L
    expect(labels).toHaveLength(1);
  });

  it('prevents L or H followed by BOS', () => {
    const labels = [swing(1, 'H', 1.05)];
    safePush(labels, swing(2, 'BOS', 1.06));
    expect(labels).toHaveLength(1);
  });

  it('allows a normal sequence: L → H → HL', () => {
    const labels: SwingResult[] = [];
    safePush(labels, swing(0, 'L', 1.00));
    safePush(labels, swing(2, 'H', 1.05));
    safePush(labels, swing(4, 'HL', 1.02));
    expect(labels).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// dedupeSwingLabels
// ---------------------------------------------------------------------------
describe('dedupeSwingLabels', () => {
  it('returns an empty array unchanged', () => {
    expect(dedupeSwingLabels([])).toEqual([]);
  });

  it('Rule 1 — removes HL/LH when HH/LL exists at the same candleIndex', () => {
    const labels = [
      swing(0, 'L', 1.00),
      swing(2, 'H', 1.10),
      swing(4, 'HH', 1.12),
      swing(4, 'HL', 1.05), // same index as HH → should be removed
    ];
    const result = dedupeSwingLabels(labels);
    const atIdx4 = result.filter(l => l.candleIndex === 4);
    expect(atIdx4.some(l => l.swing === 'HL')).toBe(false);
    expect(atIdx4.some(l => l.swing === 'HH')).toBe(true);
  });

  it('Rule 2 — removes exact duplicates (same swing, candleIndex, price)', () => {
    const labels = [
      swing(0, 'L', 1.00),
      swing(2, 'H', 1.10),
      swing(4, 'HH', 1.12),
      swing(4, 'HH', 1.12), // exact duplicate
    ];
    const result = dedupeSwingLabels(labels);
    const hhCount = result.filter(l => l.swing === 'HH').length;
    expect(hhCount).toBe(1);
  });

  it('Rule 4 — removes earlier of two consecutive same-type HH labels', () => {
    const labels = [
      swing(0, 'L', 1.00),
      swing(2, 'H', 1.10),
      swing(3, 'HH', 1.12),
      swing(5, 'HH', 1.15), // consecutive HH — earlier one removed
    ];
    const result = dedupeSwingLabels(labels);
    const hhs = result.filter(l => l.swing === 'HH');
    expect(hhs).toHaveLength(1);
    expect(hhs[0].price).toBe(1.15);
  });

  it('Rule 4 — removes earlier of two consecutive LL labels', () => {
    const labels = [
      swing(0, 'H', 1.10),
      swing(2, 'L', 1.00),
      swing(3, 'LL', 0.98),
      swing(5, 'LL', 0.95), // consecutive LL — earlier one removed
    ];
    const result = dedupeSwingLabels(labels);
    const lls = result.filter(l => l.swing === 'LL');
    expect(lls).toHaveLength(1);
    expect(lls[0].price).toBe(0.95);
  });

  it('Rule 5 — removes all BOS labels', () => {
    const labels = [
      swing(0, 'L', 1.00),
      swing(2, 'BOS', 1.08),
      swing(2, 'HH', 1.10),
      swing(4, 'BOS', 0.95),
    ];
    const result = dedupeSwingLabels(labels);
    expect(result.some(l => l.swing === 'BOS')).toBe(false);
  });

  it('sorts the result by candleIndex', () => {
    const labels = [
      swing(5, 'HH', 1.15),
      swing(0, 'L', 1.00),
      swing(2, 'H', 1.10),
    ];
    const result = dedupeSwingLabels(labels);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].candleIndex).toBeGreaterThanOrEqual(result[i - 1].candleIndex);
    }
  });
});

// ---------------------------------------------------------------------------
// isPullback
// ---------------------------------------------------------------------------
describe('isPullback', () => {
  it('returns false for an empty candle array', () => {
    const priorLL = candle(0, 0.9, 0.92, 0.90, 0.91);
    expect(isPullback([], 'HH', [priorLL], priorLL)).toBe(false);
  });

  it('returns true when price breaks below prior structure low (HH direction)', () => {
    // priorLL at 0.9000; bosCandle breaks below that low.
    // nextCandle must NOT be sideways relative to bosCandle (i.e. not inside bosCandle's range)
    // so the loop iteration actually executes the BOS check with prev=bosCandle.
    const priorLL = candle(0, 0.900, 0.920, 0.900, 0.910);
    const swingHH = candle(1, 0.930, 0.940, 0.925, 0.935);
    const bosCandle = candle(2, 0.890, 0.895, 0.880, 0.888);  // low=0.880 < priorLL.low=0.900
    const nextCandle = candle(3, 0.890, 0.935, 0.888, 0.930); // wide recovery, breaks above bosCandle
    const range = [swingHH, bosCandle, nextCandle];
    const allCandles = [priorLL, swingHH, bosCandle, nextCandle];
    expect(isPullback(range, 'HH', allCandles, priorLL)).toBe(true);
  });

  it('returns true when price breaks above prior structure high (LL direction)', () => {
    // priorHH at 1.0500; bosCandle breaks above that high.
    // nextCandle must not be sideways relative to bosCandle.
    const priorHH = candle(0, 1.040, 1.050, 1.035, 1.045);
    const swingLL = candle(1, 1.020, 1.030, 1.010, 1.015);
    const bosCandle = candle(2, 1.060, 1.070, 1.058, 1.065);  // high=1.070 > priorHH.high=1.050
    const nextCandle = candle(3, 1.055, 1.060, 1.018, 1.022); // sharp drop below bosCandle
    const range = [swingLL, bosCandle, nextCandle];
    const allCandles = [priorHH, swingLL, bosCandle, nextCandle];
    expect(isPullback(range, 'LL', allCandles, priorHH)).toBe(true);
  });

  it('returns false when no structure break and no strong candles found', () => {
    // A flat pullback with doji candles — no BOS, no strong momentum candles
    const priorLL = candle(0, 0.900, 0.920, 0.900, 0.910);
    const swingHH = candle(1, 0.930, 0.940, 0.925, 0.935);
    // Tiny doji candles — not strong, not breaking structure
    const doji1 = candle(2, 0.9305, 0.9308, 0.9302, 0.9305);
    const doji2 = candle(3, 0.9300, 0.9303, 0.9298, 0.9300);
    const doji3 = candle(4, 0.9295, 0.9298, 0.9292, 0.9295);
    const range = [swingHH, doji1, doji2, doji3];
    const allCandles = [priorLL, swingHH, doji1, doji2, doji3];
    expect(isPullback(range, 'HH', allCandles, priorLL)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// determineSwingPoints
// ---------------------------------------------------------------------------
describe('determineSwingPoints', () => {
  it('returns an empty array for 0 or 1 candles', () => {
    expect(determineSwingPoints([])).toEqual([]);
    expect(determineSwingPoints([candle(0, 1.0, 1.01, 0.99, 1.0)])).toEqual([]);
  });

  it('returns an array when given two identical candles (sideways)', () => {
    const result = determineSwingPoints([
      candle(0, 1.0, 1.01, 0.99, 1.0),
      candle(1, 1.0, 1.01, 0.99, 1.0),
    ]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('result is always sorted by candleIndex ascending', () => {
    // Build a series of candles with a clear structure-break pullback
    const priorLL = candle(0, 0.900, 0.920, 0.900, 0.910);
    const swingHH = candle(1, 0.930, 0.940, 0.925, 0.935);
    const bosCandle = candle(2, 0.920, 0.930, 0.885, 0.900);
    const nextCandle = candle(3, 0.905, 0.915, 0.895, 0.908);
    const candles = [priorLL, swingHH, bosCandle, nextCandle];
    const result = determineSwingPoints(candles);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].candleIndex).toBeGreaterThanOrEqual(result[i - 1].candleIndex);
    }
  });

  it('contains no BOS labels (dedupeSwingLabels removes them)', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      // alternating up/down to generate some structure
      const isUp = i % 4 < 2;
      const base = 1.0 + i * 0.001;
      candles.push(candle(i, base, base + 0.005, base - 0.003, base + (isUp ? 0.004 : -0.002)));
    }
    const result = determineSwingPoints(candles);
    expect(result.some(l => l.swing === 'BOS')).toBe(false);
  });

  it('returns H and L as the only swing types when initial structure cannot be confirmed', () => {
    // Only two candles → sideways detection fires, then loop ends at i===length-1
    // with no labels → fallback H and L are pushed
    const a = candle(0, 1.0, 1.05, 0.95, 1.02);
    const b = candle(1, 1.0, 1.03, 0.97, 1.01);
    const result = determineSwingPoints([a, b]);
    const types = result.map(l => l.swing);
    types.forEach(t => expect(['H', 'L']).toContain(t));
  });
});
