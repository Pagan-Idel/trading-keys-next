import { logMessage } from "../../logger.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credentialsRaw = await fs.readFile(path.join(__dirname, '../../../credentials.json'), 'utf-8');
const credentials = JSON.parse(credentialsRaw);
  // Import credentials from credentials.json

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

// Use credentials from credentials.json instead of process.env
const demoCreds: LoginRequest = {
  username: credentials.DX_DEMO_USER,
  domain: 'https://trade.gooeytrade.com/',
  password: credentials.DX_DEMO_PASSWORD
};

const liveCreds: LoginRequest = {
  username: credentials.DX_LIVE_USER,
  domain: 'https://trade.gooeytrade.com/',
  password: credentials.DX_LIVE_PASSWORD
};

export const handleDXLogin = async (accountType: string): Promise<void> => {
  const apiEndpoint = '/api/dxtrade/login';
  
  const loginRequest = {
    username: accountType === 'demo' ? demoCreds.username : liveCreds.username,
    domain: accountType === 'demo' ? demoCreds.domain : liveCreds.domain,
    password: accountType === 'demo' ? demoCreds.password : liveCreds.password,
  };

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(loginRequest),
    });

    if (!response.ok) {
      const errorResponse = await response.json();
      console.error('Login failed:', errorResponse.errorMessage);
      return;
    }

    const data = await response.json();
    logMessage('Login successful', data);
  } catch (error) {
    console.error('An error occurred during login:', error);
  }
};
