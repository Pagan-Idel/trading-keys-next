
import { logToFileAsync } from "../../logger";
import { balanceMT } from "./balance";

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
    moneyManager: null; // or appropriate type if it can be other than null
    displayMMInLeaderboard: boolean;
    leverage: number;
    verificationRequired: boolean;
    tradingAccountAutoCreation: boolean;
    recordNumber: number;
    mt5MamSystemType: null; // or appropriate type if it can be other than null
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
  
  const demoCreds: LoginMTRequest = {
    email: process.env.MTR_DEMO_EMAIL!,
    password: process.env.MTR_DEMO_PASSWORD!,
    brokerId: '0'
  };
  
  const liveCreds: LoginMTRequest = {
    email: process.env.MTR_LIVE_EMAIL!,
    password: process.env.MTR_LIVE_EMAIL!,
    brokerId: '1'
  };
  
  export const handleMTLogin = async (accountType: string): Promise<LoginMTResponse | ErrorMTResponse> => {
    localStorage.setItem('accountType', accountType);
    const apiEndpoint = '/api/match-trader/login';
    const loginRequestBody: LoginRequestBodyMT = {
      email: accountType === 'demo' ? demoCreds.email : liveCreds.email,
      password: accountType === 'demo' ? demoCreds.password : liveCreds.password,
      brokerId: accountType === 'demo' ? demoCreds.brokerId : liveCreds.brokerId
    };
  
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Hostname': accountType === 'demo' ? "https://demo.match-trader.com" : "https://mtr.gooeytrade.com"
        },
        body: JSON.stringify(loginRequestBody),
        credentials: 'include'
      });
  
      const rawResponseText = await response.text();
  
      if (!response.ok) {
        let errorResponse: ErrorMTResponse;
        try {
          errorResponse = JSON.parse(rawResponseText);
        } catch (e) {
          console.error('Error parsing error response as JSON:', e);
          throw new Error(`Error: ${rawResponseText}`);
        }
        console.error('Login failed:', errorResponse.errorMessage);
        return errorResponse;
      }
  
      let data: LoginMTResponse;
      try {
        data = JSON.parse(rawResponseText);
      } catch (e) {
        console.error('Error parsing success response as JSON:', e);
        throw new Error(`Error: ${rawResponseText}`);
      }
  
      logToFileAsync('Login Successful');

      // // Extract and store cookies from response headers
      // const cookiesHeader = response.headers.get('set-cookie');
      // if (cookiesHeader) {
      //   const cookies = cookiesHeader.split(',');
      //   for (const cookie of cookies) {
      //     const [cookieName, cookieValue] = cookie.split('=');
      //     if (cookieName && cookieValue) {
      //       // Remove any attributes like path, expires, etc.
      //       const cleanValue = cookieValue.split(';')[0].trim();
      //       if (cookieName.trim() === 'co-auth') {
      //         await setCoAuth(cleanValue);
      //       } else {
      //         localStorage.setItem(cookieName.trim(), cleanValue);
      //       }
      //     }
      //   }
      // }
      // Extract SYSTEM_UUID and store it in local storage
      const systemUuid = data.accounts[accountType === 'demo' ? 1 : 0]?.offer.system.uuid;
      if (systemUuid) {
        localStorage.setItem('SYSTEM_UUID', systemUuid);
      }

      // Extract tradingApiToken and store it in local storage
      const tradingApiToken = data.accounts[accountType === 'demo' ? 1 : 0]?.tradingApiToken;
      if (tradingApiToken) {
        localStorage.setItem('TRADING_API_TOKEN', tradingApiToken);
      }
      return data;
    } catch (error) {
      console.error('An error occurred during login:', error);
      return { errorMessage: 'An unknown error occurred during login' } as ErrorMTResponse;
    }
  };
  