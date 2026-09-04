import assert from 'node:assert/strict';
import test from 'node:test';
import { TapsaAPIError, TapsaSMS } from '../dist/index.js';

const originalFetch = globalThis.fetch;
const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test.afterEach(() => { globalThis.fetch = originalFetch; });

test('sends SMS to one recipient with the required request', async () => {
  let request;
  globalThis.fetch = async (url, init) => { request = { url, init }; return response(200, { success: true, message: 'SMS sent successfully', data: { messageId: 'msg_1', recipients: 1, cost: 1 } }); };
  const result = await new TapsaSMS({ apiKey: 'secret' }).sendSMS({ phoneNumbers: ['255712345678'], message: 'Hello', senderId: 'TAPSA' });
  assert.equal(result.data.messageId, 'msg_1');
  assert.equal(request.url, 'https://api.smstapsa.site/v1/sms/send');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers['x-api-key'], 'secret');
  assert.deepEqual(JSON.parse(request.init.body), { phoneNumbers: ['255712345678'], message: 'Hello', senderId: 'TAPSA' });
});

test('supports multiple recipients', async () => {
  globalThis.fetch = async (_url, init) => { assert.deepEqual(JSON.parse(init.body).phoneNumbers, ['255712345678', '255787654321']); return response(200, { success: true }); };
  await new TapsaSMS({ apiKey: 'secret' }).sendSMS({ phoneNumbers: ['255712345678', '255787654321'], message: 'Hello' });
});

test('gets the account balance', async () => {
  globalThis.fetch = async (url, init) => { assert.equal(url, 'https://api.smstapsa.site/v1/account/balance'); assert.equal(init.method, 'GET'); return response(200, { success: true, data: { balance: 1500, currency: 'SMS' } }); };
  assert.equal((await new TapsaSMS({ apiKey: 'secret' }).getBalance()).data.balance, 1500);
});

test('validates required inputs before fetch', async () => {
  assert.throws(() => new TapsaSMS({ apiKey: '' }), { code: 'INVALID_API_KEY' });
  const client = new TapsaSMS({ apiKey: 'secret' });
  await assert.rejects(client.sendSMS({ phoneNumbers: [], message: 'Hi' }), { code: 'INVALID_PHONE_NUMBERS' });
  await assert.rejects(client.sendSMS({ phoneNumbers: ['255712345678'], message: ' ' }), { code: 'INVALID_MESSAGE' });
  await assert.rejects(client.sendSMS({ phoneNumbers: [''], message: 'Hi' }), { code: 'INVALID_PHONE_NUMBERS' });
});

for (const status of [401, 402, 403, 429, 500]) {
  test(`preserves API error details for HTTP ${status}`, async () => {
    globalThis.fetch = async () => response(status, { success: false, message: `error ${status}`, code: `E${status}`, detail: 'useful' });
    await assert.rejects(new TapsaSMS({ apiKey: 'secret' }).getBalance(), (error) => {
      assert.ok(error instanceof TapsaAPIError);
      assert.equal(error.status, status);
      assert.equal(error.code, `E${status}`);
      assert.equal(error.message, `error ${status}`);
      assert.deepEqual(error.data, { success: false, message: `error ${status}`, code: `E${status}`, detail: 'useful' });
      return true;
    });
  });
}

test('reports malformed API responses', async () => {
  globalThis.fetch = async () => new Response('not-json', { status: 200 });
  await assert.rejects(new TapsaSMS({ apiKey: 'secret' }).getBalance(), { code: 'MALFORMED_RESPONSE', status: 200 });
});