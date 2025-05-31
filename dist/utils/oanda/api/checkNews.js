import { logMessage } from "../../logger.js";
const ACCESS_KEY = "eCIPqCm9VjTuagvDqHa9CeWSqev0kE";
const FCS_URL = "https://fcsapi.com/api-v3/forex/economy_cal";
const currencyCodes = [
    "USD", "JPY", "EUR", "GBP", "CHF", "CAD", "AUD", "NZD"
];
/**
 * Returns true if there is red folder news for this pair’s currency(s)
 * releasing within the next hour from the given timestamp.
 */
export const checkNews = async (pair, timestamp) => {
    const relevantCurrencies = currencyCodes.filter(code => pair.includes(code));
    const symbolsParam = relevantCurrencies.join(",");
    try {
        const res = await fetch(`${FCS_URL}?symbol=${symbolsParam}&access_key=${ACCESS_KEY}`);
        const data = await res.json();
        if (!data || !data.response) {
            await logMessage("⚠️ Invalid news response from FCS API");
            return false;
        }
        const now = new Date(timestamp);
        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
        const redNewsEvents = data.response.filter((event) => {
            if (!event || !event.country || !event.time || !event.impact)
                return false;
            const eventTime = new Date(`${event.date} ${event.time} UTC`);
            return (event.impact === "High" &&
                eventTime >= now &&
                eventTime <= oneHourLater &&
                relevantCurrencies.includes(event.country));
        });
        if (redNewsEvents.length > 0) {
            await logMessage(`⚠️ Red folder news upcoming for ${pair} within 1 hour`);
            return true;
        }
        return false;
    }
    catch (error) {
        await logMessage("❌ Error fetching news:", error.message);
        return false;
    }
};
