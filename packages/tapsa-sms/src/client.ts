import { TapsaAPIError } from './errors.js';
import type { BalanceResponse, SendSMSOptions, SendSMSResponse, TapsaSMSOptions } from './types.js';

const DEFAULT_BASE_URL = 'https://api.smstapsa.site';

export class TapsaSMS {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(options: TapsaSMSOptions) {
    if (!options || typeof options.apiKey !== 'string' || options.apiKey.trim() === '') {
      throw new TapsaAPIError('apiKey is required and must be a non-empty string', { code: 'INVALID_API_KEY' });
    }
    if (options.baseUrl !== undefined && (typeof options.baseUrl !== 'string' || options.baseUrl.trim() === '')) {
      throw new TapsaAPIError('baseUrl must be a non-empty string', { code: 'INVALID_BASE_URL' });
    }
    if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) {
      throw new TapsaAPIError('timeout must be a positive number', { code: 'INVALID_TIMEOUT' });
    }
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? 30_000;
  }

  async sendSMS(options: SendSMSOptions): Promise<SendSMSResponse> {
    if (!options || !Array.isArray(options.phoneNumbers) || options.phoneNumbers.length === 0) {
      throw new TapsaAPIError('phoneNumbers must be a non-empty array', { code: 'INVALID_PHONE_NUMBERS' });
    }
    if (options.phoneNumbers.some((phoneNumber) => typeof phoneNumber !== 'string' || phoneNumber.trim() === '')) {
      throw new TapsaAPIError('phoneNumbers must contain non-empty strings', { code: 'INVALID_PHONE_NUMBERS' });
    }
    if (typeof options.message !== 'string' || options.message.trim() === '') {
      throw new TapsaAPIError('message must be a non-empty string', { code: 'INVALID_MESSAGE' });
    }
    if (options.senderId !== undefined && (typeof options.senderId !== 'string' || options.senderId.trim() === '')) {
      throw new TapsaAPIError('senderId must be a non-empty string when provided', { code: 'INVALID_SENDER_ID' });
    }

    return this.request<SendSMSResponse>('/v1/sms/send', {
      method: 'POST',
      body: JSON.stringify({
        phoneNumbers: options.phoneNumbers,
        message: options.message,
        ...(options.senderId === undefined ? {} : { senderId: options.senderId })
      })
    });
  }

  async getBalance(): Promise<BalanceResponse> {
    return this.request<BalanceResponse>('/v1/account/balance', { method: 'GET' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          ...init.headers
        }
      });
      const text = await response.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new TapsaAPIError('TAPSA API returned malformed JSON', {
          status: response.status,
          code: 'MALFORMED_RESPONSE',
          response,
          data: text
        });
      }
      if (!response.ok) {
        const body = data as { message?: unknown; error?: unknown; code?: unknown };
        const message = typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : `TAPSA API request failed with status ${response.status}`;
        throw new TapsaAPIError(message, {
          status: response.status,
          code: typeof body.code === 'string' ? body.code : `HTTP_${response.status}`,
          response,
          data
        });
      }
      return data as T;
    } catch (error) {
      if (error instanceof TapsaAPIError) throw error;
      const message = error instanceof Error && error.name === 'AbortError' ? 'TAPSA API request timed out' : error instanceof Error ? error.message : 'TAPSA API request failed';
      throw new TapsaAPIError(message, { code: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}