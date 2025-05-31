;
/**
 * Deduplicates swing labels.
 * - For HH or LL: keeps only the highest/lowest in each group.
 * - Removes exact duplicates of any swing label (same swing, candleIndex, and price).
 */
export function dedupeSwingLabels(labels) {
    // ✅ Sort labels by candleIndex to ensure correct order
    labels.sort((a, b) => a.candleIndex - b.candleIndex);
    console.log("🟡 Original Labels:");
    labels.forEach(l => {
        console.log(`[Candle ${l.candleIndex}] → ${l.swing} at ${l.price}`);
    });
    // 🧹 Rule 1: Remove HL or LH if HH or LL exists at same candleIndex
    for (let i = labels.length - 1; i >= 0; i--) {
        const curr = labels[i];
        if (curr.swing === 'HL' || curr.swing === 'LH') {
            const hasMajor = labels.some(l => (l.swing === 'HH' || l.swing === 'LL') && l.candleIndex === curr.candleIndex);
            if (hasMajor) {
                labels.splice(i, 1);
            }
        }
    }
    // 🧹 Rule 2: Remove exact duplicates
    const seen = new Set();
    for (let i = labels.length - 1; i >= 0; i--) {
        const key = `${labels[i].swing}-${labels[i].candleIndex}-${labels[i].price}`;
        if (seen.has(key)) {
            console.log(`🧹 Rule 2: Removing duplicate`, labels[i]);
            labels.splice(i, 1);
        }
        else {
            seen.add(key);
        }
    }
    // Grouping HH/LL
    const result = [];
    let group = [];
    function flushGroup() {
        if (!group.length)
            return;
        const type = group[0].swing;
        console.log(`🔶 Flushing group of ${type}:`, group.map(g => `[Candle ${g.candleIndex} → ${g.price}]`).join(', '));
        const chosen = type === 'HH'
            ? group.reduce((a, b) => (a.price > b.price ? a : b))
            : group.reduce((a, b) => (a.price < b.price ? a : b));
        console.log(`✅ Kept: Candle ${chosen.candleIndex} → ${type} at ${chosen.price}`);
        result.push(chosen);
        group = [];
    }
    for (const label of labels) {
        if (label.swing === 'HH' || label.swing === 'LL') {
            if (group.length && group[0].swing !== label.swing) {
                flushGroup();
            }
            group.push(label);
        }
        else {
            flushGroup();
            result.push(label);
        }
    }
    flushGroup();
    console.log("\n🟢 Final Cleaned Labels:");
    result.forEach(l => console.log(`[Candle ${l.candleIndex}] → ${l.swing} at ${l.price}`));
    return result;
}
export function safePush(labels, newLabel) {
    const last = labels[labels.length - 1];
    // 1. Skip if identical swing and price
    if (last &&
        last.swing === newLabel.swing &&
        last.price === newLabel.price) {
        return;
    }
    // 2. Keep only highest HH
    // console.log('Last:', last);
    // console.log('New:', newLabel);
    // if (newLabel.swing === 'HH' && last?.swing === 'HH') {
    //     if (newLabel.price >= last.price) {
    //         labels.pop();
    //         labels.push(newLabel);
    //     }
    //     return;
    // }
    // // 3. Keep only lowest LL
    // if (newLabel.swing === 'LL' && last?.swing === 'LL') {
    //     if (newLabel.price <= last.price) {
    //         labels.pop();
    //         labels.push(newLabel);
    //     }
    //     return;
    // }
    // 4. Prevent HL after L or LH after H
    // if ((last?.swing === 'L' && newLabel.swing === 'HL') ||
    //     (last?.swing === 'H' && newLabel.swing === 'LH')) {
    //     return;
    // }
    // 5. Prevent duplicate BOS
    if (last?.swing === 'BOS' && newLabel.swing === 'BOS') {
        return;
    }
    // 6. Prevent L or H followed by same price
    if ((last?.swing === 'L' || last?.swing === 'H') &&
        newLabel.price === last.price) {
        return;
    }
    // 7. Prevent L or H followed by BOS
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
    //     console.log(`⚠️ Blocked ${newLabel.swing} at index ${newLabel.candleIndex} — BOS/HH/LL already exists there`);
    //     return;
    //   }
    // ✅ Push the new label
    labels.push(newLabel);
}
function getAverageRange(candles) {
    const ranges = candles.map(c => c.high - c.low);
    const sum = ranges.reduce((acc, r) => acc + r, 0);
    return sum / candles.length;
}
// Dont forget to change filter parameters
function isStrongBody(candle, averageRange) {
    const bodySize = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    const minRange = .3 * averageRange;
    return range >= minRange && bodySize >= .4 * range;
}
function findHighestPoint(candles) {
    let highest = candles[0];
    for (const c of candles) {
        if (c.high > highest.high)
            highest = c;
    }
    return { price: highest.high, candleIndex: highest.candleIndex };
}
function findLowestPoint(candles) {
    let lowest = candles[0];
    for (const c of candles) {
        if (c.low < lowest.low)
            lowest = c;
    }
    return { price: lowest.low, candleIndex: lowest.candleIndex };
}
function isPullback(candles, direction, allCandles) {
    const averageRange = getAverageRange(allCandles);
    if (candles.length === 0)
        return false;
    // Reference swing candle
    const swingCandle = candles[0];
    const swingHigh = swingCandle.high;
    const swingLow = swingCandle.low;
    candles = candles.slice(1); // exclude the swing candle itself
    let sidewaysCandle = null;
    let sidewaysMovement = false;
    let candleToCompare = null;
    let candle1Found = false;
    let candle2Found = false;
    for (let i = 1; i < candles.length; i++) {
        const prev = sidewaysMovement && sidewaysCandle ? sidewaysCandle : candles[i - 1];
        const curr = candles[i];
        sidewaysMovement = false;
        const strongPrev = isStrongBody(prev, averageRange);
        const strongCurr = isStrongBody(curr, averageRange);
        // Step 2: Find pullback candle 1
        if (!candle1Found) {
            if (direction === 'HH' &&
                strongPrev &&
                prev.low < swingLow &&
                prev.close < swingLow) {
                candle1Found = true;
                candleToCompare = prev;
                continue;
            }
            if (direction === 'LL' &&
                strongPrev &&
                prev.high > swingHigh &&
                prev.close > swingHigh) {
                candle1Found = true;
                candleToCompare = prev;
                continue;
            }
            if (direction === 'HH' &&
                strongCurr &&
                curr.low < swingLow &&
                curr.close < swingLow) {
                candle1Found = true;
                candleToCompare = curr;
                continue;
            }
            if (direction === 'LL' &&
                strongCurr &&
                curr.high > swingHigh &&
                curr.close > swingHigh) {
                candle1Found = true;
                candleToCompare = curr;
                continue;
            }
        }
        // Step 3: Find confirming candle 2
        else if (candleToCompare && isStrongBody(curr, averageRange)) {
            const isValid = (direction === 'LL' &&
                curr.high > candleToCompare.high &&
                curr.low > candleToCompare.low &&
                curr.close > candleToCompare.high) ||
                (direction === 'HH' &&
                    curr.high < candleToCompare.high &&
                    curr.low < candleToCompare.low &&
                    curr.close < candleToCompare.low);
            if (isValid) {
                candle2Found = true;
            }
        }
        // Sideways detection
        if (curr.high === prev.high && curr.low === prev.low) {
            sidewaysMovement = true;
            sidewaysCandle = {
                ...curr,
                high: Math.max(prev.high, curr.high),
                low: Math.min(prev.low, curr.low),
                open: curr.open,
                close: curr.close,
                startTime: curr.startTime,
                endTime: curr.endTime,
                candleIndex: curr.candleIndex,
            };
        }
        if (candle1Found && candle2Found) {
            return true;
        }
    }
    return false;
}
// Main Swing Point Detection
export function determineSwingPoints(candles) {
    // console.log('🔽 Starting Swing Detection...');
    // console.log('🕯️ Full Candle Set:', candles);
    const labels = [];
    let potentialLL = null;
    let potentialHH = null;
    let potentialLLIndex = -1;
    let potentialHHIndex = -1;
    let trend = undefined;
    for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        const lastLow = labels.slice().reverse().find(l => l.swing === 'LL' || l.swing === 'L');
        const lastHigh = labels.slice().reverse().find(l => l.swing === 'HH' || l.swing === 'H');
        const reversed = labels.slice().reverse();
        let lastMidPoint = reversed.find(l => l.swing === 'LH' || l.swing === 'HL' || l.swing === 'H' || l.swing === 'L');
        if (lastMidPoint) {
            const lastIndex = labels.length - 1;
            const midIndex = labels.findIndex(l => l.swing === lastMidPoint.swing &&
                l.candleIndex === lastMidPoint.candleIndex &&
                l.price === lastMidPoint.price);
            // Check for BOS between midpoint and the last label
            const inBetween = labels.slice(midIndex + 1, lastIndex);
            const hasBOS = inBetween.some(l => l.swing === 'BOS');
            if (hasBOS) {
                lastMidPoint = undefined;
            }
        }
        if (lastLow && lastHigh) {
            if (lastLow.candleIndex > lastHigh.candleIndex) {
                trend = 'bearish';
            }
            else if (lastHigh.candleIndex > lastLow.candleIndex) {
                trend = 'bullish';
            }
        }
        //console.log('Trend:', trend);
        // console.log(`\n➡️ Candle ${i} | High: ${curr.high}, Low: ${curr.low}`);
        if (lastHigh && (curr.high > lastHigh.price || prev.high > lastHigh.price)) {
            // console.log(`🔍 New HH candidate found — comparing to last HH/H at ${lastHigh.price}`);
            const between = candles.slice(lastHigh.candleIndex, i);
            if (isPullback(between, 'HH', candles)) {
                potentialHH = curr.high > lastHigh.price ? curr : prev;
                // 🟨 BOS CHECK: If previous swing was LL or L → this HH is a BOS
                //const lastSwing = labels[labels.length - 1];
                if (trend = 'bearish') {
                    safePush(labels, { candleIndex: curr.candleIndex, swing: 'BOS', price: curr.high });
                    trend = 'bullish';
                }
                safePush(labels, { candleIndex: potentialHH.candleIndex, swing: 'HH', price: potentialHH.high });
                for (let j = i + 1; j < candles.length; j++) {
                    const next = candles[j];
                    if (next.high > potentialHH.high) {
                        potentialHH = next;
                        safePush(labels, { candleIndex: potentialHH.candleIndex, swing: 'HH', price: potentialHH.high });
                        trend = 'bullish';
                        // console.log(`📈 Extended potentialHH to candle ${j} at ${next.high}`);
                    }
                    else {
                        // A BUG PROBABLY HERE, 
                        const pullback = candles.slice(potentialHH.candleIndex, j);
                        if (isPullback(pullback, 'HH', candles)) {
                            // const lastLabel = labels[labels.length - 1];
                            // const isLastBOS = lastLabel?.swing === 'LL' || lastLabel?.swing === 'L';
                            if (trend == 'bullish') {
                                const { price, candleIndex } = findLowestPoint(candles.slice(lastHigh.candleIndex, potentialHH.candleIndex));
                                safePush(labels, { candleIndex, swing: 'HL', price });
                            }
                            safePush(labels, { candleIndex: potentialHH.candleIndex, swing: 'HH', price: potentialHH.high });
                            trend = 'bullish';
                            break;
                        }
                    }
                }
                i++;
            }
        }
        if (lastLow && (curr.low < lastLow.price || prev.low < lastLow.price)) {
            const between = candles.slice(lastLow.candleIndex, i);
            if (isPullback(between, 'LL', candles)) {
                potentialLL = curr.low < lastLow.price ? curr : prev;
                if (trend == 'bullish') {
                    safePush(labels, { candleIndex: curr.candleIndex, swing: 'BOS', price: curr.low });
                    trend = 'bearish';
                }
                safePush(labels, { candleIndex: potentialLL.candleIndex, swing: 'LL', price: potentialLL.low });
                for (let j = i + 1; j < candles.length; j++) {
                    const next = candles[j];
                    if (next.low < potentialLL.low) {
                        potentialLL = next;
                        safePush(labels, { candleIndex: potentialLL.candleIndex, swing: 'LL', price: potentialLL.low });
                        trend = 'bearish';
                    }
                    else {
                        const pullback = candles.slice(potentialLL.candleIndex, j);
                        if (isPullback(pullback, 'LL', candles)) {
                            if (trend === 'bearish') {
                                const { price, candleIndex } = findHighestPoint(candles.slice(lastLow.candleIndex, potentialLL.candleIndex));
                                safePush(labels, { candleIndex, swing: 'LH', price });
                            }
                            safePush(labels, { candleIndex: potentialLL.candleIndex, swing: 'LL', price: potentialLL.low });
                            trend = 'bearish';
                            break;
                        }
                    }
                    i++;
                }
            }
        }
        if ((lastMidPoint?.swing === 'LH' || lastMidPoint?.swing === 'H') && trend === 'bearish') {
            const brokeStructure = prev.high > lastMidPoint.price || curr.high > lastMidPoint.price;
            if (brokeStructure) {
                const bosCandle = prev.high > lastMidPoint.price ? prev : curr;
                // console.log(`⚔️ BOS above last LH at ${lastLH.price} using candle ${bosCandle.candleIndex}`);
                safePush(labels, { candleIndex: bosCandle.candleIndex, swing: 'BOS', price: bosCandle.high });
                trend = 'bullish';
                // Track how far the breakout goes before pullback
                let extremeHH = bosCandle;
                for (let j = extremeHH.candleIndex + 1; j < candles.length; j++) {
                    const next = candles[j];
                    if (next.high > extremeHH.high) {
                        extremeHH = next;
                        safePush(labels, { candleIndex: extremeHH.candleIndex, swing: 'HH', price: extremeHH.high });
                        trend = 'bullish';
                    }
                    else {
                        const range = candles.slice(extremeHH.candleIndex, j);
                        if (isPullback(range, 'HH', candles)) {
                            safePush(labels, { candleIndex: extremeHH.candleIndex, swing: 'HH', price: extremeHH.high });
                            trend = 'bullish';
                            break;
                        }
                    }
                    i++;
                }
            }
        }
        if ((lastMidPoint?.swing === 'HL' || lastMidPoint?.swing === 'L') && trend === 'bullish') {
            const brokeStructure = prev.low < lastMidPoint.price || curr.low < lastMidPoint.price;
            if (brokeStructure) {
                const bosCandle = prev.low < lastMidPoint.price ? prev : curr;
                safePush(labels, { candleIndex: bosCandle.candleIndex, swing: 'BOS', price: bosCandle.low });
                trend = 'bearish';
                // Track how far the breakout goes before pullback
                let extremeLL = bosCandle;
                for (let j = extremeLL.candleIndex + 1; j < candles.length; j++) {
                    const next = candles[j];
                    if (next.low < extremeLL.low) {
                        extremeLL = next;
                        safePush(labels, { candleIndex: extremeLL.candleIndex, swing: 'LL', price: extremeLL.low });
                        trend = 'bearish';
                    }
                    else {
                        const range = candles.slice(extremeLL.candleIndex, j);
                        if (isPullback(range, 'LL', candles)) {
                            safePush(labels, { candleIndex: extremeLL.candleIndex, swing: 'LL', price: extremeLL.low });
                            trend = 'bearish';
                            break;
                        }
                    }
                }
                i++;
            }
        }
        if (!labels.length) {
            if (!potentialLL || !potentialHH) {
                potentialHH = candles[0];
                potentialLL = candles[0];
            }
            if (curr.low < potentialLL.low || prev.low < potentialLL.low) {
                potentialLL = curr.low < potentialLL.low ? curr : prev;
                potentialLLIndex = i;
            }
            if (curr.high > potentialHH.high || prev.high > potentialHH.high) {
                potentialHH = !potentialHH || curr.high > potentialHH.high ? curr : prev;
                potentialHHIndex = i;
            }
            // Trend starts with HH forming after LL
            if (potentialLLIndex < potentialHHIndex) {
                for (let j = i + 1; j < candles.length; j++) {
                    const next = candles[j];
                    if (next.high > potentialHH.high) {
                        potentialHH = next;
                        potentialHHIndex = j;
                    }
                    else {
                        const range = candles.slice(potentialHHIndex, j);
                        if (isPullback(range, 'HH', candles)) {
                            labels.push({ candleIndex: potentialLL.candleIndex, swing: 'L', price: potentialLL.low });
                            labels.push({ candleIndex: potentialHH.candleIndex, swing: 'H', price: potentialHH.high });
                            break;
                        }
                    }
                }
            }
            // Trend starts with LL forming after HH
            else if (potentialHHIndex < potentialLLIndex) {
                for (let j = i + 1; j < candles.length; j++) {
                    const next = candles[j];
                    if (next.low < potentialLL.low) {
                        potentialLL = next;
                        potentialLLIndex = j;
                    }
                    else {
                        const range = candles.slice(potentialLLIndex, j);
                        if (isPullback(range, 'LL', candles)) {
                            labels.push({ candleIndex: potentialHH.candleIndex, swing: 'H', price: potentialHH.high });
                            labels.push({ candleIndex: potentialLL.candleIndex, swing: 'L', price: potentialLL.low });
                            break;
                        }
                    }
                }
            }
        }
        if (i === candles.length - 1 && labels.length === 0) {
            const { price: highPrice, candleIndex: highIndex } = findHighestPoint(candles);
            const { price: lowPrice, candleIndex: lowIndex } = findLowestPoint(candles);
            // console.log(`📌 Last candle & no labels: Adding H at ${highPrice}, L at ${lowPrice}`);
            labels.push({ candleIndex: highIndex, swing: 'H', price: highPrice });
            labels.push({ candleIndex: lowIndex, swing: 'L', price: lowPrice });
        }
    }
    // console.log('\n✅ Final Swing Labels:', labels);
    return dedupeSwingLabels(labels);
    // return labels;
}
