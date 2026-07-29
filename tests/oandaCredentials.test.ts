import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getOandaCredentials } from '../utils/oandaCredentials.ts';

test('selects complete practice credentials from the environment', () => {
  assert.deepEqual(getOandaCredentials('demo', {
    OANDA_DEMO_ACCOUNT_ID: 'practice-account',
    OANDA_DEMO_ACCOUNT_TOKEN: 'practice-secret',
  }), {
    environment: 'demo',
    accountId: 'practice-account',
    token: 'practice-secret',
    baseUrl: 'https://api-fxpractice.oanda.com',
    streamUrl: 'https://stream-fxpractice.oanda.com',
  });
});

test('selects complete live credentials independently from practice values', () => {
  const selected = getOandaCredentials('live', {
    OANDA_DEMO_ACCOUNT_ID: 'ignored-demo',
    OANDA_DEMO_ACCOUNT_TOKEN: 'ignored-demo-secret',
    OANDA_LIVE_ACCOUNT_ID: 'live-account',
    OANDA_LIVE_ACCOUNT_TOKEN: 'live-secret',
  });
  assert.equal(selected.accountId, 'live-account');
  assert.equal(selected.token, 'live-secret');
  assert.equal(selected.baseUrl, 'https://api-fxtrade.oanda.com');
  assert.equal(selected.streamUrl, 'https://stream-fxtrade.oanda.com');
});

test('missing token errors identify only the environment variable', () => {
  const secret = 'must-never-appear';
  assert.throws(
    () => getOandaCredentials('demo', { OANDA_DEMO_ACCOUNT_ID: secret }),
    error => {
      assert.match(String(error), /OANDA_DEMO_ACCOUNT_TOKEN/);
      assert.doesNotMatch(String(error), new RegExp(secret));
      return true;
    },
  );
});

test('missing account ID errors identify only the environment variable', () => {
  const secret = 'must-never-appear';
  assert.throws(
    () => getOandaCredentials('live', { OANDA_LIVE_ACCOUNT_TOKEN: secret }),
    error => {
      assert.match(String(error), /OANDA_LIVE_ACCOUNT_ID/);
      assert.doesNotMatch(String(error), new RegExp(secret));
      return true;
    },
  );
});

test('credential adapter has no credentials.json dependency', () => {
  const source = fs.readFileSync(path.resolve('utils/oandaCredentials.ts'), 'utf8');
  assert.doesNotMatch(source, /credentials\.json|readFileSync|node:fs/);
});
