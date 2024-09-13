import { logToFileAsync } from "../../logger";

export interface LoginRequest {
  username: string;
  domain: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expires: string;
}

export interface ErrorResponse {
  errorMessage: string;
}

const demoCreds: LoginRequest = {
  username: process.env.DX_DEMO_USER!,
  domain: 'https://trade.gooeytrade.com/',
  password: process.env.DX_DEMO_PASSWORD!
};

const liveCreds: LoginRequest = {
  username:  process.env.DX_LIVE_USER!,
  domain: 'https://trade.gooeytrade.com/',
  password:  process.env.DX_LIVE_PASSWORD!
};

export const handleDXLogin = async (accountType: string): Promise<void> => { 
  
  const apiEndpoint = '/api/dxtrade/login';
  const loginRequest = {
    username: accountType === 'demo' ? demoCreds.username : liveCreds.username,
    domain:  accountType === 'demo' ? demoCreds.domain : liveCreds.domain,
    password:  accountType === 'demo' ? demoCreds.password : liveCreds.password,
  };

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 'Accountenv': `${accountEnv}`
      },
      body: JSON.stringify(loginRequest),
    });

    if (!response.ok) {
      const errorResponse = await response.json();
      console.error('Login failed:', errorResponse.errorMessage);
      return;
    }

    const data = await response.json();
    logToFileAsync('Login successful', data);
  } catch (error) {
    console.error('An error occurred during login:', error);
  }
};