import { afterEach, describe, expect, it, vi } from 'vitest';
import { TapsaAPIError, TapsaSMS } from '../src/index.js';

const originalFetch = globalThis.fetch;
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TapsaSMS', () => {
  it('creates a client with the default base URL', () => {
    expect(() => new TapsaSMS({ apiKey: 'secret' })).not.toThrow();
  });

  it('rejects a missing API key', () => {
    expect(() => new TapsaSMS({ apiKey: '' })).toThrowError(TapsaAPIError);
  });

  it('sends SMS with the endpoint, headers, and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, message: 'SMS sent successfully', data: { messageId: 'msg_1', recipients: 1, cost: 1 } }));
    globalThis.fetch = fetchMock;
    const result = await new TapsaSMS({ apiKey: 'secret' }).sendSMS({ phoneNumbers: ['255712345678'], message: 'Hello', senderId: 'TAPSA' });
    expect(result.data.messageId).toBe('msg_1');
    expect(fetchMock).toHaveBeenCalledWith('https://api.smstapsa.my.id/v1/sms/send', expect.objectContaining({ method: 'POST' }));
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((request.headers as Record<string, string>)['x-api-key']).toBe('secret');
    expect(JSON.parse(request.body as string)).toEqual({ phoneNumbers: ['255712345678'], message: 'Hello', senderId: 'TAPSA' });
  });

  it('supports multiple recipients and base URL overrides', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    globalThis.fetch = fetchMock;
    await new TapsaSMS({ apiKey: 'secret', baseUrl: 'http://localhost:3000/' }).sendSMS({ phoneNumbers: ['255712345678', '255713456789'], message: 'Hello everyone' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3000/v1/sms/send');
  });

  it('gets the account balance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: { balance: 1500, currency: 'SMS' } }));
    globalThis.fetch = fetchMock;
    const result = await new TapsaSMS({ apiKey: 'secret' }).getBalance();
    expect(result.data.balance).toBe(1500);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.smstapsa.my.id/v1/account/balance');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('GET');
  });

  it('sends email with a generated idempotency key and the email API endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, message: 'Email queued' }));
    globalThis.fetch = fetchMock;
    await new TapsaSMS({ apiKey: 'secret' }).sendEmail({ to: 'customer@example.com', subject: 'Welcome', html: '<p>Hello!</p>' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.smstapsa.my.id/api/v1/email/send');
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = request.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('secret');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.parse(request.body as string)).toEqual({ to: 'customer@example.com', subject: 'Welcome', html: '<p>Hello!</p>' });
  });

  it('reuses a supplied idempotency key for email retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    globalThis.fetch = fetchMock;
    await new TapsaSMS({ apiKey: 'secret' }).sendEmail({ to: 'customer@example.com', subject: 'Welcome', html: '<p>Hello!</p>', idempotencyKey: 'retry-key-1' });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ 'Idempotency-Key': 'retry-key-1' });
  });

  it('validates phone numbers, messages, and sender IDs', async () => {
    const client = new TapsaSMS({ apiKey: 'secret' });
    await expect(client.sendSMS({ phoneNumbers: [], message: 'Hi' })).rejects.toMatchObject({ code: 'INVALID_PHONE_NUMBERS' });
    await expect(client.sendSMS({ phoneNumbers: [''], message: 'Hi' })).rejects.toMatchObject({ code: 'INVALID_PHONE_NUMBERS' });
    await expect(client.sendSMS({ phoneNumbers: ['255712345678'], message: ' ' })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    await expect(client.sendSMS({ phoneNumbers: ['255712345678'], message: 'Hi', senderId: ' ' })).rejects.toMatchObject({ code: 'INVALID_SENDER_ID' });
  });

  it('validates required email fields and idempotency keys', async () => {
    const client = new TapsaSMS({ apiKey: 'secret' });
    await expect(client.sendEmail({ to: '', subject: 'Welcome', html: '<p>Hello!</p>' })).rejects.toMatchObject({ code: 'INVALID_EMAIL_RECIPIENT' });
    await expect(client.sendEmail({ to: 'customer@example.com', subject: ' ', html: '<p>Hello!</p>' })).rejects.toMatchObject({ code: 'INVALID_EMAIL_SUBJECT' });
    await expect(client.sendEmail({ to: 'customer@example.com', subject: 'Welcome', html: ' ' })).rejects.toMatchObject({ code: 'INVALID_EMAIL_HTML' });
    await expect(client.sendEmail({ to: 'customer@example.com', subject: 'Welcome', html: '<p>Hello!</p>', idempotencyKey: ' ' })).rejects.toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY' });
  });

  for (const status of [400, 401, 402, 403, 429, 500]) {
    it(`preserves HTTP ${status} API errors`, async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(status, { success: false, message: `error ${status}`, code: `E${status}`, detail: 'useful' }));
      try {
        await new TapsaSMS({ apiKey: 'secret' }).getBalance();
        throw new Error('Expected request to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(TapsaAPIError);
        expect(error).toMatchObject({ status, code: `E${status}`, message: `error ${status}` });
        expect((error as TapsaAPIError).data).toEqual({ success: false, message: `error ${status}`, code: `E${status}`, detail: 'useful' });
      }
    });
  }

  it('reports network failures without exposing credentials', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(new TapsaSMS({ apiKey: 'secret-key' }).getBalance()).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: 'connection refused' });
    await expect(new TapsaSMS({ apiKey: 'secret-key' }).getBalance()).rejects.not.toThrow('secret-key');
  });
});