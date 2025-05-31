export const marketWatchMT = async (currency = "EURUSD") => {
    let accountType = "";
    let tradingApiToken = "";
    let systemUuid = "";
    if (typeof window !== "undefined") {
        accountType = localStorage.getItem("accountType") || "";
        tradingApiToken = localStorage.getItem("TRADING_API_TOKEN") || "";
        systemUuid = localStorage.getItem("SYSTEM_UUID") || "";
    }
    const apiEndpoint = "/api/match-trader/market-watch";
    try {
        const response = await fetch(apiEndpoint, {
            method: "GET",
            headers: {
                TRADING_API_TOKEN: tradingApiToken,
                SYSTEM_UUID: systemUuid,
                Accept: "application/json",
                Hostname: accountType === "demo"
                    ? "https://demo.match-trader.com"
                    : "https://mtr.gooeytrade.com",
            },
            credentials: "include",
        });
        const rawResponseText = await response.text();
        if (!response.ok) {
            try {
                const errorResponse = JSON.parse(rawResponseText);
                console.error("Market Watch failed:", errorResponse.errorMessage);
                return errorResponse;
            }
            catch (e) {
                throw new Error(`Error parsing error response: ${rawResponseText}`);
            }
        }
        const data = JSON.parse(rawResponseText);
        // ✅ Filter by specific currency if passed
        const filtered = data.filter(item => item.symbol === currency.toUpperCase());
        if (filtered.length === 0) {
            return {
                errorMessage: `Currency ${currency} not found in market watch data.`
            };
        }
        return filtered;
    }
    catch (error) {
        console.error("An error occurred during market watch:", error);
        return {
            errorMessage: "An unknown error occurred during market watch"
        };
    }
};
