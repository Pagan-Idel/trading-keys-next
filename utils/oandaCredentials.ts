export type OandaEnvironment = 'demo' | 'live';

export type OandaCredentials = {
  accountId: string;
  token: string;
  baseUrl: string;
  streamUrl: string;
  environment: OandaEnvironment;
};

type EnvironmentSource = Record<string, string | undefined>;

const required = (
  environment: OandaEnvironment,
  name: 'ACCOUNT_ID' | 'ACCOUNT_TOKEN',
  source: EnvironmentSource,
): string => {
  const variable = `OANDA_${environment === 'live' ? 'LIVE' : 'DEMO'}_${name}`;
  const value = source[variable]?.trim();
  if (!value) {
    throw new Error(`OANDA ${environment} credentials are unavailable: ${variable} is required.`);
  }
  return value;
};

export const getOandaCredentials = (
  environment: OandaEnvironment,
  source: EnvironmentSource = process.env,
): OandaCredentials => ({
  environment,
  accountId: required(environment, 'ACCOUNT_ID', source),
  token: required(environment, 'ACCOUNT_TOKEN', source),
  baseUrl: environment === 'live'
    ? 'https://api-fxtrade.oanda.com'
    : 'https://api-fxpractice.oanda.com',
  streamUrl: environment === 'live'
    ? 'https://stream-fxtrade.oanda.com'
    : 'https://stream-fxpractice.oanda.com',
});

const credentials = {
  get OANDA_DEMO_ACCOUNT_ID(): string {
    return required('demo', 'ACCOUNT_ID', process.env);
  },
  get OANDA_DEMO_ACCOUNT_TOKEN(): string {
    return required('demo', 'ACCOUNT_TOKEN', process.env);
  },
  get OANDA_LIVE_ACCOUNT_ID(): string {
    return required('live', 'ACCOUNT_ID', process.env);
  },
  get OANDA_LIVE_ACCOUNT_TOKEN(): string {
    return required('live', 'ACCOUNT_TOKEN', process.env);
  },
};

export default credentials;
