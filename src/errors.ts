export interface TapsaAPIErrorOptions {
  status?: number;
  code?: string;
  response?: Response;
  data?: unknown;
}

export class TapsaAPIError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly response?: Response;
  readonly data?: unknown;

  constructor(message: string, options: TapsaAPIErrorOptions = {}) {
    super(message);
    this.name = 'TapsaAPIError';
    this.status = options.status;
    this.code = options.code;
    this.response = options.response;
    this.data = options.data;
  }
}
