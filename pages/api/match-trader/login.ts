// pages/api/login.ts
import { NextApiRequest, NextApiResponse } from 'next';
import redisClient from './redisClient';

export interface LoginRequest {
  username: string;
  broker: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expires: string;
}

export interface ErrorResponse {
  errorMessage: string;
}

export interface CookieOptions {
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: Date;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }
  if (!req.url?.includes('login')) {
    res.status(404).end(`Path ${req.url} Not Found`);
    return;
  }
  const hostname = "https://mtr.gooeytrade.com";
  const credentials: LoginRequest = req.body;
  const api: string = "/manager/co-login";
  try {
    const response = await fetch(hostname + api, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(credentials)
    });

    if (!response.ok) {
      const errorResponse: ErrorResponse = await response.json();
      console.log(`HTTP error! Status: ${response.status}`, errorResponse);
      res.status(response.status).json({ errorMessage: `HTTP error! Status: ${response.status}`, details: errorResponse });
      return;

    }

    const cookiesHeader = response.headers.get('set-cookie');
    console.log("Cookie recieved: ", cookiesHeader);
    if (cookiesHeader) {
      // Regular expression to match only the co-auth cookie with its attributes and Path
      const regex = /rt=([^;]+)/;
      const match = cookiesHeader.match(regex);
      
      if (match && match.length > 0) {
          // Capture group 1
          const cookieValue: string = match[0].split("=").pop() as string; // Entire match includes group 1
          redisClient.set('co-auth', cookieValue);
          console.log("cookieValue to set ", cookieValue);
      } else {
          console.error('co-auth cookie not found');
      }
  }
 
    const data = await response.json();
    res.status(200).json(data);
  } catch (error: unknown) {
    let errorMessage = 'An unknown error occurred';

    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    console.log(`Error: ${errorMessage}`);
    res.status(500).json({ errorMessage: `Error: ${errorMessage}` });
  }
}
