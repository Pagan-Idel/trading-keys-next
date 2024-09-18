import { logToFileAsync } from "../../logger";
import credentials from "../../../credentials.json";  // Import credentials.json at the top
import { storeTokensInRedis } from "../../shared";

export interface LoginRequestBodyMT {
  email: string;
  password: string;
  brokerId: string;
}

export interface LoginMTResponse {
  email: string;
  token: string;
  accounts: Account[];
}

export interface Account {
  tradingAccountId: string;
  offer: Offer;
  tradingApiToken: string;
  branchUuid: string;
  created: string;
  uuid: string;
}

export interface Offer {
  uuid: string;
  partnerId: string;
  created: string;
  name: string;
  currency: string;
  description: string;
  initialDeposit: number;
  demo: boolean;
  hidden: boolean;
  branch: Branch;
  system: System;
  moneyManager: null;
  displayMMInLeaderboard: boolean;
  leverage: number;
  verificationRequired: boolean;
  tradingAccountAutoCreation: boolean;
  recordNumber: number;
  mt5MamSystemType: null;
  offerRedirect: string;
}

export interface Branch {
  uuid: string;
}

export interface System {
  demo: boolean;
  name: string;
  uuid: string;
  active: boolean;
  systemType: string;
  tradingApiDomain: string;
}

export interface ErrorMTResponse {
  errorMessage: string;
}

export interface LoginMTRequest {
  email: string;
  password: string;
  brokerId: string;
}

// Using credentials from credentials.json instead of process.env
const demoCreds: LoginMTRequest = {
  email: credentials.MTR_DEMO_EMAIL,
  password: credentials.MTR_DEMO_PASSWORD,
  brokerId: '0',
};

const liveCreds: LoginMTRequest = {
  email: credentials.MTR_LIVE_EMAIL,
  password: credentials.MTR_LIVE_PASSWORD,
  brokerId: '1',
};

export const handleMTLogin = async (
  accountType: string
): Promise<LoginMTResponse | ErrorMTResponse> => {
  // Ensure localStorage is only accessed on the client-side
  if (typeof window === 'undefined') {
    return { errorMessage: 'localStorage is not available in the current environment.' } as ErrorMTResponse;
  }

  // Set account type in local storage
  localStorage.setItem("accountType", accountType);

  const apiEndpoint = "/api/match-trader/login";
  const loginRequestBody: LoginRequestBodyMT = {
    email: accountType === "demo" ? demoCreds.email : liveCreds.email,
    password: accountType === "demo" ? demoCreds.password : liveCreds.password,
    brokerId: accountType === "demo" ? demoCreds.brokerId : liveCreds.brokerId,
  };

  try {
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Hostname:
          accountType === "demo"
            ? "https://demo.match-trader.com"
            : "https://mtr.gooeytrade.com",
      },
      body: JSON.stringify(loginRequestBody),
      credentials: "include",
    });

    const rawResponseText = await response.text();

    if (!response.ok) {
      let errorResponse: ErrorMTResponse;
      try {
        errorResponse = JSON.parse(rawResponseText);
      } catch (e) {
        console.error("Error parsing error response as JSON:", e);
        throw new Error(`Error: ${rawResponseText}`);
      }
      console.error("Login failed:", errorResponse.errorMessage);
      return errorResponse;
    }

    let data: LoginMTResponse;
    try {
      data = JSON.parse(rawResponseText);
    } catch (e) {
      console.error("Error parsing success response as JSON:", e);
      throw new Error(`Error: ${rawResponseText}`);
    }

    logToFileAsync("Login Successful");

    // Extract SYSTEM_UUID and store it in local storage
    const systemUuid = data.accounts[accountType === "demo" ? 1 : 0]?.offer.system.uuid;
    // Extract tradingApiToken and store it in local storage
    const tradingApiToken = data.accounts[accountType === "demo" ? 1 : 0]?.tradingApiToken;
    if (systemUuid && tradingApiToken) {
      storeTokensInRedis(tradingApiToken, systemUuid);
      localStorage.setItem("SYSTEM_UUID", systemUuid);
      localStorage.setItem("TRADING_API_TOKEN", tradingApiToken);
    }

    return data;
  } catch (error) {
    console.error("An error occurred during login:", error);
    return { errorMessage: "An unknown error occurred during login" } as ErrorMTResponse;
  }
};
