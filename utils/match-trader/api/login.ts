export interface RequestMTBody {
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
  }
  
  const demoCreds: LoginMTRequest = {
    email: '[redacted]',
    password: '[redacted]'
  };
  
  const liveCreds: LoginMTRequest = {
    email: '',
    password: ''
  };
  
  export const handleMTLogin = async (accountType: string): Promise<LoginMTResponse | ErrorMTResponse> => {
    const apiEndpoint = '/api/match-trader/login';
    const loginRequest: RequestMTBody = {
      email: accountType === 'demo' ? demoCreds.email : liveCreds.email,
      password: accountType === 'demo' ? demoCreds.password : liveCreds.password,
      brokerId: '1',
    };
  
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(loginRequest),
      });
  
      const rawResponseText = await response.text();
      console.log('Raw response:', rawResponseText);
  
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
  
      console.log('Login successful', data);
      return data;
    } catch (error) {
      console.error('An error occurred during login:', error);
      return { errorMessage: 'An unknown error occurred during login' } as ErrorMTResponse;
    }
  };
  