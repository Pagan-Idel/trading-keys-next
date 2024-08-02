// pages/api/login.ts
import { NextApiRequest, NextApiResponse } from 'next';

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

    const responseData: LoginResponse = await response.json();
    const cookies = response.headers.get('set-cookie');
    console.log("Cookies - Next", cookies);
    if (cookies) {
        // // Split cookies by ','
        // const cookieArray = cookies.split(',');
    
        // // Map over each cookie and remove the Domain attribute
        // const modifiedCookies = cookieArray.map(cookie => 
        //     cookie.replace(/;\s*Domain=[^;]+/, '')
        // );
    
        // // Combine modified cookies into a single header
        // const cookieHeader = modifiedCookies.join(',');
    
        // Set the modified cookies in the response header
        res.setHeader('Set-Cookie', cookies);
    }

    res.status(200).json(responseData);
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
