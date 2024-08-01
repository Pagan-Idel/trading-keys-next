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
  username: '[redacted]',
  domain: 'https://trade.gooeytrade.com/',
  password: '[redacted]'
};

const liveCreds: LoginRequest = {
  username: '[redacted]',
  domain: 'https://trade.gooeytrade.com/',
  password: '[redacted]'
};

export const handleDXLogin = async (accountType: string) => {
  const accountEnv = localStorage.getItem('accountEnv');
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
        'Accountenv': `${accountEnv}`
      },
      body: JSON.stringify(loginRequest),
    });

    if (!response.ok) {
      const errorResponse = await response.json();
      console.error('Login failed:', errorResponse.errorMessage);
      return;
    }

    const data = await response.json();
    console.log('Login successful', data);
  } catch (error) {
    console.error('An error occurred during login:', error);
  }
};