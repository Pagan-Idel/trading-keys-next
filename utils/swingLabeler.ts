// import { log } from "console";
// import { logMessage } from "./logger";
// import { wait } from "./shared";

export type Candle = {
    time: string; // ISO 8601 format
    candleIndex: number;
    high: number;
    low: number;
    open: number;
    close: number;
};

export interface SwingResult {
    candleIndex: number;
    swing: 'L' | 'H' | 'HH' | 'LL' | 'HL' | 'LH' | 'BOS';
    price: number;
    time?: string; // Optional, can be used for logging or display
};

export type Trend = 'bullish' | 'bearish' | undefined;

export type PullbackReason = 'structure_broken' | 'not_enough_momentum' | 'valid';

export type PullbackResult =
    | { confirmed: true; reason?: PullbackReason }
    | { confirmed: false; reason: PullbackReason };

// local helper – Chicago-time pretty string
const toLocalTime = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    });

/**
 * Deduplicates swing labels.
 * - For HH or LL: keeps only the highest/lowest in each group.
 * - Removes exact duplicates of any swing label (same swing, candleIndex, and price).
 */
export function dedupeSwingLabels(labels: SwingResult[]): SwingResult[] {
    // ✅ Sort labels by candleIndex to ensure correct order
    labels.sort((a, b) => a.candleIndex - b.candleIndex);

    // 🧹 Rule 1: Remove HL or LH if HH or LL exists at same candleIndex
    for (let i = labels.length - 1; i >= 0; i--) {
        const curr = labels[i];
        if (curr.swing === 'HL' || curr.swing === 'LH') {
            const hasMajor = labels.some(
                l => (l.swing === 'HH' || l.swing === 'LL') && l.candleIndex === curr.candleIndex
            );
            if (hasMajor) {
                labels.splice(i, 1);
            }
        }
    }

    // 🧹 Rule 2: Remove exact duplicates
    const seen = new Set<string>();
    for (let i = labels.length - 1; i >= 0; i--) {
        const key = `${labels[i].swing}-${labels[i].candleIndex}-${labels[i].price}`;
        if (seen.has(key)) {
            // logMessage(`🧹 Rule 2: Removing duplicate`, labels[i]);
            labels.splice(i, 1);
        } else {
            seen.add(key);
        }
    }

    // 🧹 Rule 3: Ensure first two are only H and L, remove anything in between
    const hIndex = labels.findIndex(l => l.swing === 'H');
    const lIndex = labels.findIndex(l => l.swing === 'L');

    if (hIndex !== -1 && lIndex !== -1) {
        const firstIndex = Math.min(hIndex, lIndex);
        const secondIndex = Math.max(hIndex, lIndex);

        // Keep only the first H and L, remove anything between them
        labels = labels.filter((_, i) =>
            i <= firstIndex || i >= secondIndex || i === hIndex || i === lIndex
        );

        // Re-sort after filtering
        labels.sort((a, b) => a.candleIndex - b.candleIndex);
    }
    // 🧹 Rule 4: Remove repeated LL or HH, keep the later one
    for (let i = 1; i < labels.length; i++) {
        const prev = labels[i - 1];
        const curr = labels[i];

        if ((curr.swing === 'LL' || curr.swing === 'HH') && curr.swing === prev.swing) {
            labels.splice(i - 1, 1); // Remove the previous label
            i--; // Adjust index after removal
        }
    }

    // 🧹 Rule 5: Remove all BOS labels
    for (let i = labels.length - 1; i >= 0; i--) {
        if (labels[i].swing === 'BOS') {
            labels.splice(i, 1);
        }
    }


    return labels;
}


export function safePush(labels: SwingResult[], newLabel: SwingResult) {
    const last = labels[labels.length - 1];

    // 1. Skip if identical swing and price
    if (last &&
        last.swing === newLabel.swing &&
        last.price === newLabel.price) {
        return;
    }

    // 2. Prevent duplicate BOS
    if (last?.swing === 'BOS' && newLabel.swing === 'BOS') {
        return;
    }

    // 3. Prevent L or H followed by same price
    if ((last?.swing === 'L' || last?.swing === 'H') &&
        newLabel.price === last.price) {
        return;
    }

    // 4. Prevent L or H followed by BOS
    if ((last?.swing === 'L' || last?.swing === 'H') &&
        newLabel.swing === 'BOS') {
        return;
    }

    // Prevent HL/LH if HH/LL exists at same index
    // ❌ Prevent HL or LH if BOS, HH, or LL already exists at same index
    // if (
    //     (newLabel.swing === 'HL' || newLabel.swing === 'LH') &&
    //     labels.some(l =>
    //       ['BOS', 'HH', 'LL'].includes(l.swing) &&
    //       l.candleIndex === newLabel.candleIndex
    //     )
    //   ) {
    // //// // // logMessage(`⚠️ Blocked ${newLabel.swing} at index ${newLabel.candleIndex} — BOS/HH/LL already exists there`, undefined, { fileName: "swingLabeler" });
    //     return;
    //   }

    // ✅ Push the new label
    labels.push(newLabel);
    // logMessage(`New Label Pushed - ${newLabel.swing} at ${toLocalTime(newLabel.time)} at idx=${newLabel.candleIndex}`, undefined, { fileName: "swingLabeler" });
}

export function getAverageRange(candles: Candle[]): number {
    const ranges = candles.map(c => c.high - c.low);
    const sum = ranges.reduce((acc, r) => acc + r, 0);
    return sum / candles.length;
}

export function isStrongBody(candle: Candle, averageRange: number): boolean {
    const bodySize = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    const minRange = 0.50 * averageRange;
    const isStrong = range >= minRange && bodySize >= 0.50 * range;

    // logMessage(
    //     `🟨 Checking strong body: index=${candle.candleIndex} (${toLocalTime(candle.time)}), range=${range.toFixed(
    //         5
    //     )}, bodySize=${bodySize.toFixed(5)}, isStrong=${isStrong}`,
    //     undefined,
    //     { fileName: "swingLabeler" }
    // );

    return isStrong;
}

function findHighestPoint(candles: Candle[]): { price: number; candleIndex: number, time?: string } {
    let highest = candles[0];
    for (const c of candles) {
        if (c.high > highest.high) highest = c;
    }
    // logMessage(`🔺 Highest point found: ${highest.high} at index ${highest.candleIndex}`, undefined, { fileName: "swingLabeler" });
    return { price: highest.high, candleIndex: highest.candleIndex, time: highest.time };
}

function findLowestPoint(candles: Candle[]): { price: number; candleIndex: number, time: string } {
    let lowest = candles[0];
    for (const c of candles) {
        if (c.low < lowest.low) lowest = c;
    }
    // logMessage(`🔻 Lowest point found: ${lowest.low} at index ${lowest.candleIndex}`, undefined, { fileName: "swingLabeler" });
    return { price: lowest.low, candleIndex: lowest.candleIndex, time: lowest.time };
}


export function isPullback(
    candles: Candle[],
    direction: "LL" | "HH",
    allCandles: Candle[],
    priorStructurePoint: SwingResult | Candle,
    priorMidPoint?: SwingResult
): boolean {
    const priorTime = new Date(priorStructurePoint.time ?? 0).getTime();
    const startIdx = allCandles.findIndex(
        (c) => new Date(c.time).getTime() === priorTime
    );
    const rangeSlice = startIdx >= 0 ? allCandles.slice(startIdx) : allCandles;
    const averageRange = getAverageRange(rangeSlice);

    // logMessage(
    //     `📊 isPullback start | direction: ${direction}, range candles: ${candles.length}, Prior Structure Point ${toLocalTime(priorStructurePoint.time)}, Prior Mid Point ${priorMidPoint ? toLocalTime(priorMidPoint.time) : "undefined"}`,
    //     { swingTime: toLocalTime(priorStructurePoint.time) },
    //     { fileName: "swingLabeler" }
    // );

    if (candles.length === 0) {
        return false;
    }

    const swingCandle = candles[0];
    const isSwingResult = (point: any): point is SwingResult => "swing" in point;

    const swingHigh =
        direction === "LL"
            ? isSwingResult(priorStructurePoint)
                ? priorStructurePoint.price
                : priorStructurePoint.high
            : 0;
    const swingLow =
        direction === "HH"
            ? isSwingResult(priorStructurePoint)
                ? priorStructurePoint.price
                : priorStructurePoint.low
            : 0;

    candles = candles.slice(1); // Exclude the swing itself

    // // Log all candles in range
    // logMessage(`📋 Pullback range candles:`, undefined, { fileName: "swingLabeler" });
    // candles.forEach((c) => {
    //     const time = toLocalTime(c.time);
    //     const range = (c.high - c.low).toFixed(5);
    //     const body = Math.abs(c.close - c.open).toFixed(5);
    //     const strong = isStrongBody(c, averageRange);
    //     logMessage(
    //         `🕯️ idx=${c.candleIndex} (${time}) | open=${c.open} high=${c.high} low=${c.low} close=${c.close} | range=${range} body=${body} | strong=${strong}`,
    //         undefined,
    //         { level: "info", fileName: "swingLabeler" }
    //     );
    // });

    let sidewaysCandle: Candle | null = null;
    let sidewaysMovement = false;
    let candleToCompare: Candle | null = null;
    let candle1Found = false;
    let candle2Found = false;

    for (let i = 1; i < candles.length; i++) {
        const prev: Candle = sidewaysMovement && sidewaysCandle ? sidewaysCandle : candles[i - 1];
        const curr: Candle = candles[i];

        sidewaysMovement = false;

        const isSideways =
            (curr.high === prev.high && curr.low === prev.low) ||
            (curr.high <= prev.high && curr.low >= prev.low) ||
            (prev.high <= curr.high && prev.low >= curr.low);

        if (isSideways) {
            sidewaysMovement = true;
            const useCurr =
                (curr.high === prev.high && curr.low === prev.low) ||
                curr.high > prev.high ||
                curr.low < prev.low;

            const reference = useCurr ? curr : prev;

            // we are combining the body and the range of the biggest candle
            const prevBody = Math.abs(prev.close - prev.open);
            const currBody = Math.abs(curr.close - curr.open);

            const useBiggerBody = currBody > prevBody ? curr : prev;
            sidewaysCandle = {
                ...reference,
                high: Math.max(curr.high, prev.high),
                low: Math.min(curr.low, prev.low),
                open: useBiggerBody.open,
                close: useBiggerBody.close,
                time: reference.time,
                candleIndex: reference.candleIndex,
            };

            // logMessage(`↔️ Sideways merged at ${sidewaysCandle.candleIndex}`, undefined, { fileName: "swingLabeler" });
            continue;
        }

        // Break of structure check
        if (
            (direction === "HH" && prev.low < swingLow) ||
            (direction === "LL" && prev.high > swingHigh) ||
            (priorMidPoint &&
                ((direction === "HH" && priorMidPoint.swing === "HL" && prev.low < priorMidPoint.price) ||
                    (direction === "LL" && priorMidPoint.swing === "LH" && prev.high > priorMidPoint.price)))
        ) {
            // logMessage(`🚫 Candle ${prev.candleIndex} broke structure at ${toLocalTime(prev.time)}`, undefined, { fileName: "swingLabeler" });
            return true;
        }

        const strong = isStrongBody(prev, averageRange);

        if (!candle1Found && strong) {
            candle1Found = true;
            candleToCompare = prev;
            // logMessage(
            //     `🟡 First pullback candle @ ${prev.candleIndex} (${toLocalTime(prev.time)})`,
            //     undefined,
            //     { fileName: "swingLabeler" }
            // );
            continue;
        }

        if (candle1Found && candleToCompare && strong) {
            const isValid =
                (direction === "LL" &&
                    prev.high > candleToCompare.high &&
                    prev.low > candleToCompare.low &&
                    prev.close > candleToCompare.high &&
                    prev.close > swingCandle.low) ||
                (direction === "HH" &&
                    prev.high < candleToCompare.high &&
                    prev.low < candleToCompare.low &&
                    prev.close < candleToCompare.low &&
                    prev.close < swingCandle.low);

            if (isValid) {
                candle2Found = true;
                // logMessage(
                //     `✅ Pullback confirmed with second candle @ ${prev.candleIndex} (${toLocalTime(prev.time)})`,
                //     undefined,
                //     { fileName: "swingLabeler" }
                // );
            }
        }

        if (candle1Found && candle2Found) {
            //     logMessage(
            //         `✅ Pullback confirmed overall for direction ${direction}`,
            //         undefined,
            //         { fileName: "swingLabeler" }
            //     );
            return true;
        }
    }

    // logMessage(`❌ Pullback not confirmed for direction ${direction}`, undefined, {
    //     fileName: "swingLabeler",
    // });

    return false;
}



export function determineSwingPoints(candles: Candle[]): SwingResult[] {
    const labels: SwingResult[] = [];

    let potentialLL: Candle | null = null;
    let potentialHH: Candle | null = null;
    let trend: Trend = undefined;
    let sidewaysCandle: Candle | null = null;
    let sidewaysMovement = false;

    for (let i = 1; i < candles.length; i++) {
        const prev: Candle = sidewaysMovement && sidewaysCandle ? sidewaysCandle : candles[i - 1];
        const curr: Candle = candles[i];
        sidewaysMovement = false;
        // logMessage(
        //     `🔁 Main Loop i=${i} | prevIdx=${prev.candleIndex} (${toLocalTime(prev.time)}), currIdx=${curr.candleIndex} (${toLocalTime(curr.time)})`,
        //     undefined,
        //     {
        //         level: "debug",
        //         fileName: "swingLabeler"
        //     }
        // );
        sidewaysMovement = false;

        const lastLow = labels.slice().reverse().find(l => l.swing === 'LL' || l.swing === 'L');
        const lastHigh = labels.slice().reverse().find(l => l.swing === 'HH' || l.swing === 'H');
        const reversed = labels.slice().reverse();

        const isSideways =
            (curr.high === prev.high && curr.low === prev.low) ||
            (curr.high <= prev.high && curr.low >= prev.low) ||
            (prev.high <= curr.high && prev.low >= curr.low);

        if (isSideways) {
            sidewaysMovement = true;
            const useCurr =
                (curr.high === prev.high && curr.low === prev.low) ||
                (curr.high > prev.high || curr.low < prev.low);

            const reference = useCurr ? curr : prev;

            sidewaysCandle = {
                ...reference,
                high: Math.max(curr.high, prev.high),
                low: Math.min(curr.low, prev.low),
                open: reference.open,
                close: reference.close,
                time: reference.time,
                candleIndex: reference.candleIndex,
            };
            // logMessage(
            //     `↔️ Sideways candle detected at i=${i}`,
            //     undefined,
            //     { level: "debug", fileName: "swingLabeler" }
            // );
            continue;
        }

        if (!labels.length) {
            const first = prev;
            const second = curr;

            let potentialHH = first.high > second.high ? first : second;
            let potentialLL = first.low < second.low ? first : second;

            let potentialHHIndex = potentialHH.candleIndex;
            let potentialLLIndex = potentialLL.candleIndex;
            // logMessage(
            //     `🟡 potentialHH: [index=${potentialHH.candleIndex}, time=${toLocalTime(potentialHH.time)}, high=${potentialHH.high} | ` +
            //     `potentialLL: [index=${potentialLL.candleIndex}, time=${toLocalTime(potentialLL.time)}, low=${potentialLL.low}`,
            //     undefined,
            //     { fileName: "swingLabeler" }
            // );
            if (potentialLLIndex < potentialHHIndex) {
                for (let j = i + 1; j < candles.length; j++) {
                    // logMessage(`🔄 Entering inner loop: i=${i}, j=${j}`, undefined, {
                    //     level: "debug",
                    //     fileName: "swingLabeler"
                    // });
                    const next = candles[j];
                    if (next.high > potentialHH.high) {
                        potentialHH = next;
                        potentialHHIndex = next.candleIndex;
                        // logMessage(
                        //     `📈 New potentialHH updated at index=${next.candleIndex} | time=${next.time} | open=${next.open} | high=${next.high} | low=${next.low} | close=${next.close}`,
                        //     undefined,
                        //     { level: "debug", fileName: "swingLabeler" }
                        // );
                    } else {
                        const range = candles.slice(potentialHHIndex, j);
                        if (isPullback(range, 'HH', candles, potentialLL)) {
                            labels.push({ candleIndex: potentialLL.candleIndex, swing: 'L', price: potentialLL.low, time: potentialLL.time });
                            labels.push({ candleIndex: potentialHH.candleIndex, swing: 'H', price: potentialHH.high, time: potentialHH.time });
                            // logMessage(`🟢 Initial trend: L then H | LL at ${potentialLL.low}, HH at ${potentialHH.high}`, undefined, { fileName: "swingLabeler" });
                            i = j;
                            break;
                        }
                    }
                }
            } else {
                for (let j = i + 1; j < candles.length; j++) {
                    // logMessage(`🔄 Entering inner loop: i=${i}, j=${j}`, undefined, {
                    //     level: "debug",
                    //     fileName: "swingLabeler"
                    // });
                    const next = candles[j];
                    if (next.low < potentialLL.low) {
                        potentialLL = next;
                        potentialLLIndex = next.candleIndex;
                    } else {
                        const range = candles.slice(potentialLLIndex, j);
                        if (isPullback(range, 'LL', candles, potentialHH)) {
                            labels.push({ candleIndex: potentialHH.candleIndex, swing: 'H', price: potentialHH.high, time: potentialHH.time });
                            labels.push({ candleIndex: potentialLL.candleIndex, swing: 'L', price: potentialLL.low, time: potentialLL.time });
                            // logMessage(`🟢 Initial trend: H then L | HH at ${potentialHH.high}, LL at ${potentialLL.low}`, undefined, { fileName: "swingLabeler" });
                            i = j;
                            break;
                        }
                    }
                }
            }

            continue;
        }

        let lastMidPoint: SwingResult | undefined = reversed.find(l => l.swing === 'LH' || l.swing === 'HL' || l.swing === 'H' || l.swing === 'L');
        if (lastMidPoint) {
            const lastIndex = labels.length - 1;
            const midIndex = labels.findIndex(l =>
                l.swing === lastMidPoint!.swing &&
                l.candleIndex === lastMidPoint!.candleIndex &&
                l.price === lastMidPoint!.price
            );

            const inBetween = labels.slice(midIndex + 1, lastIndex);
            const hasBOS = inBetween.some(l => l.swing === 'BOS');

            if (hasBOS) {
                lastMidPoint = undefined;
            }
        }
        if (lastLow && lastHigh) {
            if (lastLow.candleIndex > lastHigh.candleIndex) {
                trend = 'bearish';
            } else if (lastHigh.candleIndex > lastLow.candleIndex) {
                trend = 'bullish';
            }
        }

        if (lastHigh && (prev.high > lastHigh.price)) {
            // logMessage(`Inside lastHigh: ${lastHigh.swing} at ${toLocalTime(lastHigh.time)}, and prev high = ${prev.high} -  i=${i}`, undefined, {
            //     level: "debug",
            //     fileName: "swingLabeler"
            // });

            potentialHH = prev;

            if (trend !== 'bullish') {
                safePush(labels, { candleIndex: potentialHH.candleIndex, swing: 'BOS', price: potentialHH.high, time: potentialHH.time });

                trend = 'bullish';
            }
            safePush(labels, { candleIndex: potentialHH.candleIndex, swing: 'HH', price: potentialHH.high, time: potentialHH.time });

            // 2a. **Grab the accompanying HL right away**

            // Non-null assertion for lastLow
            const { price: hlPrice, candleIndex: hlIndex, time: hlTime } =
                findLowestPoint(candles.slice(lastHigh.candleIndex, potentialHH.candleIndex));
            safePush(labels, { candleIndex: hlIndex, swing: 'HL', price: hlPrice, time: hlTime });

            // 3. Explore forward for more HHs
            for (let j = potentialHH.candleIndex + 1; j < candles.length; j++) {
                // logMessage(`🔄 Entering inner loop: i=${i}, j=${j}`, undefined, {
                //     level: "debug",
                //     fileName: "swingLabeler"
                // });
                const next = candles[j];
                if (next.high > potentialHH.high) {
                    potentialHH = next;
                    safePush(labels, { candleIndex: potentialHH.candleIndex, swing: 'HH', price: potentialHH.high, time: potentialHH.time });
                } else {
                    const pullback = candles.slice(potentialHH.candleIndex, j);
                    // Non-null assertion for lastLow
                    const check = isPullback(pullback, 'HH', candles, lastLow!, { candleIndex: hlIndex, swing: 'HL', price: hlPrice, time: hlTime });
                    if (check) {
                        i = j - 2;
                        break;
                    }
                }
            }
        }

        if (lastLow && (prev.low < lastLow.price)) {
            // logMessage(`Inside LastLow i=${i}`, undefined, {
            //     level: "debug",
            //     fileName: "swingLabeler"
            // });
            potentialLL = prev;

            // 1. Trend flip & BOS
            if (trend !== 'bearish') {
                safePush(labels, { candleIndex: potentialLL.candleIndex, swing: 'BOS', price: potentialLL.low, time: potentialLL.time });

                trend = 'bearish';
            }
            safePush(labels, { candleIndex: potentialLL.candleIndex, swing: 'LL', price: potentialLL.low, time: potentialLL.time });

            // 2a. **Grab the accompanying LH right away**

            // Non-null assertion for lastHigh
            const { price: lhPrice, candleIndex: lhIndex, time: lhTime } =
                findHighestPoint(candles.slice(lastLow.candleIndex, potentialLL.candleIndex));
            safePush(labels, { candleIndex: lhIndex, swing: 'LH', price: lhPrice, time: lhTime });

            // 3. Explore forward for more LLs
            for (let j = potentialLL.candleIndex + 1; j < candles.length; j++) {
                // logMessage(`🔄 Entering inner loop: i=${i}, j=${j}`, undefined, {
                //     level: "debug",
                //     fileName: "swingLabeler"
                // });
                const next = candles[j];
                if (next.low < potentialLL.low) {
                    potentialLL = next;
                    safePush(labels, { candleIndex: potentialLL.candleIndex, swing: 'LL', price: potentialLL.low, time: potentialLL.time });
                } else {
                    const pullback = candles.slice(potentialLL.candleIndex, j);
                    // Non-null assertion for lastHigh
                    const check = isPullback(pullback, 'LL', candles, lastHigh!, { candleIndex: lhIndex, swing: 'LH', price: lhPrice, time: lhTime });
                    if (check) {
                        i = j - 2;
                        break;     // exit; outer loop will resume after the pull-back
                    }
                }
            }

        }

        if ((lastMidPoint?.swing === 'LH' || lastMidPoint?.swing === 'H') && trend === 'bearish') {
            // logMessage(`Inside LH i=${i}`, undefined, {
            //     level: "debug",
            //     fileName: "swingLabeler"
            // });
            const brokeStructure = prev.high > lastMidPoint.price;
            if (brokeStructure) {
                const bosCandle = prev;

                // 1. Trend flip & BOS
                safePush(labels, { candleIndex: bosCandle.candleIndex, swing: 'BOS', price: bosCandle.high, time: bosCandle.time });
                // logMessage(`🟥 BOS (trend reversal to bullish) at ${bosCandle.high}`, undefined, { fileName: "swingLabeler" });
                trend = 'bullish';

                // 2. First HH of the new leg
                let extremeHH = bosCandle;
                safePush(labels, { candleIndex: extremeHH.candleIndex, swing: 'HH', price: extremeHH.high, time: extremeHH.time });

                // 3. Explore forward for more HHs
                for (let j = extremeHH.candleIndex + 1; j < candles.length; j++) {
                    // logMessage(`🔄 Entering inner loop: i=${i}, j=${j}`, undefined, {
                    //     level: "debug",
                    //     fileName: "swingLabeler"
                    // });
                    const next = candles[j];
                    if (next.high > extremeHH.high) {
                        extremeHH = next;
                        safePush(labels, { candleIndex: extremeHH.candleIndex, swing: 'HH', price: extremeHH.high, time: extremeHH.time });
                    } else {
                        const range = candles.slice(extremeHH.candleIndex, j);
                        // @ts-ignore
                        const check = isPullback(range, 'HH', candles, lastLow, lastMidPoint);
                        if (check) {
                            i = j - 2;
                            break;
                        }
                    }
                }
            }
        }

        if ((lastMidPoint?.swing === 'HL' || lastMidPoint?.swing === 'L') && trend === 'bullish') {
            // logMessage(`Indise HL i=${i}`, undefined, {
            //     level: "debug",
            //     fileName: "swingLabeler"
            // });
            const brokeStructure = prev.low < lastMidPoint.price;
            if (brokeStructure) {
                const bosCandle = prev;

                // 1. Trend flip & BOS
                safePush(labels, { candleIndex: bosCandle.candleIndex, swing: 'BOS', price: bosCandle.low, time: bosCandle.time });
                // logMessage(`🟥 BOS (trend reversal to bearish) at ${bosCandle.low}`, undefined, { fileName: "swingLabeler" });
                trend = 'bearish';

                // 2. First LL of the new leg
                let extremeLL = bosCandle;
                safePush(labels, { candleIndex: extremeLL.candleIndex, swing: 'LL', price: extremeLL.low, time: extremeLL.time });

                // 3. Explore forward for more LLs
                for (let j = extremeLL.candleIndex + 1; j < candles.length; j++) {
                    // logMessage(`🔄 Entering inner loop: i=${i}, j=${j}`, undefined, {
                    //     level: "debug",
                    //     fileName: "swingLabeler"
                    // });
                    const next = candles[j];
                    if (next.low < extremeLL.low) {
                        extremeLL = next;
                        safePush(labels, { candleIndex: extremeLL.candleIndex, swing: 'LL', price: extremeLL.low, time: extremeLL.time });
                    } else {
                        const range = candles.slice(extremeLL.candleIndex, j);
                        // @ts-ignore
                        const check = isPullback(range, 'LL', candles, lastHigh, lastMidPoint);
                        if (check) {
                            i = j - 2;
                            break;
                        }
                    }
                }
            }
        }

        if (i === candles.length - 1 && labels.length === 0) {
            const { price: highPrice, candleIndex: highIndex } = findHighestPoint(candles);
            const { price: lowPrice, candleIndex: lowIndex } = findLowestPoint(candles);
            safePush(labels, { candleIndex: highIndex, swing: 'H', price: highPrice });
            safePush(labels, { candleIndex: lowIndex, swing: 'L', price: lowPrice });
        }
    }

    const finalLabels = dedupeSwingLabels(labels).sort((a, b) => a.candleIndex - b.candleIndex);

    // const finalLabels = labels.sort((a, b) => a.candleIndex - b.candleIndex);

    return finalLabels;
}