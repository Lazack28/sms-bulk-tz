export interface TapsaSMSOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface SendSMSOptions {
  phoneNumbers: string[];
  message: string;
  senderId?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  idempotencyKey?: string;
}

export interface SendEmailResponse {
  success: boolean;
  message?: string;
  data?: unknown;
}

export interface SendSMSData {
  messageId: string;
  recipients: number;
  cost: number;
}

export interface SendSMSResponse {
  success: boolean;
  message: string;
  data: SendSMSData;
}

export interface BalanceData {
  balance: number;
  currency: string;
}

export interface BalanceResponse {
  success: boolean;
  data: BalanceData;
}