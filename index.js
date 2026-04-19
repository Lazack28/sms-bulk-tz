"use strict";

const axios = require("axios");

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://api.smstapsa.site/v1";
const DEFAULT_SENDER_ID = "TAPSA";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_MESSAGE_LENGTH = 160;
const PHONE_REGEX = /^255\d{9}$/; // Tanzania: 255XXXXXXXXX

// ─────────────────────────────────────────────
// Custom Error Class
// ─────────────────────────────────────────────

class SMSError extends Error {
  /**
   * @param {string} message   Human-readable description
   * @param {string} code      Machine-readable error code
   * @param {number} [status]  HTTP status code (if from API)
   * @param {*}      [raw]     Raw API response body (if available)
   */
  constructor(message, code, status = null, raw = null) {
    super(message);
    this.name = "SMSError";
    this.code = code;
    this.status = status;
    this.raw = raw;
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Pause execution for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Validate a single phone number string.
 * @param {string} phone
 * @returns {{ valid: boolean, reason?: string }}
 */
function validatePhone(phone) {
  if (typeof phone !== "string") {
    return { valid: false, reason: `Expected string, got ${typeof phone}` };
  }
  if (!PHONE_REGEX.test(phone)) {
    return {
      valid: false,
      reason: `"${phone}" does not match required format 255XXXXXXXXX`,
    };
  }
  return { valid: true };
}

/**
 * Validate and normalise the recipients value into a string array.
 * Accepts a single phone string or an array of phone strings.
 *
 * @param {string|string[]} recipients
 * @returns {string[]}
 * @throws {SMSError}
 */
function normaliseRecipients(recipients) {
  const list = Array.isArray(recipients) ? recipients : [recipients];

  if (list.length === 0) {
    throw new SMSError("At least one recipient is required", "INVALID_RECIPIENTS");
  }

  const invalid = [];
  for (const phone of list) {
    const { valid, reason } = validatePhone(phone);
    if (!valid) invalid.push({ phone, reason });
  }

  if (invalid.length > 0) {
    const details = invalid.map((e) => `  • ${e.reason}`).join("\n");
    throw new SMSError(
      `Invalid phone number(s):\n${details}`,
      "INVALID_PHONE_NUMBER"
    );
  }

  return list;
}

/**
 * Validate a message string.
 * @param {string} message
 * @throws {SMSError}
 */
function validateMessage(message) {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new SMSError("Message must be a non-empty string", "INVALID_MESSAGE");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new SMSError(
      `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters (got ${message.length})`,
      "MESSAGE_TOO_LONG"
    );
  }
}

// ─────────────────────────────────────────────
// Main Class
// ─────────────────────────────────────────────

class SMSBulkTZ {
  /**
   * @param {object}  options
   * @param {string}  options.apiKey              Your TAPSA API key
   * @param {string}  [options.senderId]          Sender ID shown to recipients (default: "TAPSA")
   * @param {string}  [options.baseURL]           Override API base URL
   * @param {number}  [options.timeout]           Request timeout in ms (default: 10 000)
   * @param {number}  [options.retryAttempts]     Max retry attempts on transient errors (default: 3)
   * @param {number}  [options.retryDelay]        Initial delay between retries in ms (default: 500)
   * @param {boolean} [options.debug]             Enable verbose debug logging (default: false)
   */
  constructor({
    apiKey,
    senderId,
    baseURL,
    timeout,
    retryAttempts,
    retryDelay,
    debug,
  } = {}) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
      throw new SMSError("A valid API key is required", "MISSING_API_KEY");
    }

    this.apiKey = apiKey.trim();
    this.senderId = (senderId || DEFAULT_SENDER_ID).trim();
    this.baseURL = (baseURL || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = typeof timeout === "number" && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
    this.retryAttempts = typeof retryAttempts === "number" && retryAttempts >= 0 ? retryAttempts : DEFAULT_RETRY_ATTEMPTS;
    this.retryDelay = typeof retryDelay === "number" && retryDelay >= 0 ? retryDelay : DEFAULT_RETRY_DELAY_MS;
    this.debug = Boolean(debug);

    /** @private */
    this._http = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
    });
  }

  // ─── Private helpers ─────────────────────────

  /** @private */
  _log(...args) {
    if (this.debug) console.debug("[sms-bulk-tz]", ...args);
  }

  /**
   * Execute an axios request with automatic retry on transient failures.
   * @private
   * @param {Function} requestFn  () => Promise (an axios call)
   * @returns {Promise<import("axios").AxiosResponse>}
   */
  async _requestWithRetry(requestFn) {
    let lastError;
    let delay = this.retryDelay;

    for (let attempt = 1; attempt <= this.retryAttempts + 1; attempt++) {
      try {
        this._log(`Attempt ${attempt}…`);
        return await requestFn();
      } catch (err) {
        lastError = err;
        const status = err.response?.status;

        // Do not retry on client errors (4xx) — they won't change on retry.
        const isClientError = status && status >= 400 && status < 500;
        const isLastAttempt = attempt > this.retryAttempts;

        if (isClientError || isLastAttempt) break;

        this._log(`Transient error (status ${status ?? "network"}). Retrying in ${delay}ms…`);
        await sleep(delay);
        delay *= 2; // Exponential back-off
      }
    }

    throw this._normaliseAxiosError(lastError);
  }

  /**
   * Convert an Axios error into a structured SMSError.
   * @private
   * @param {Error} err
   * @returns {SMSError}
   */
  _normaliseAxiosError(err) {
    if (err instanceof SMSError) return err;

    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      return new SMSError(
        `Request timed out after ${this.timeout}ms`,
        "REQUEST_TIMEOUT",
        null,
        null
      );
    }

    if (!err.response) {
      return new SMSError(
        `Network error: ${err.message}`,
        "NETWORK_ERROR",
        null,
        null
      );
    }

    const { status, data } = err.response;
    const apiMessage = data?.error || data?.message || "Unknown API error";

    const codeMap = {
      400: "BAD_REQUEST",
      401: "UNAUTHORIZED",
      402: "INSUFFICIENT_BALANCE",
      500: "SERVER_ERROR",
    };

    return new SMSError(
      apiMessage,
      codeMap[status] || "API_ERROR",
      status,
      data
    );
  }

  // ─── Public API ───────────────────────────────

  /**
   * Send an SMS message to one or more recipients in a single API call.
   *
   * @param {object}         options
   * @param {string|string[]} options.to        Phone number(s) in 255XXXXXXXXX format
   * @param {string}          options.message   Message text (max 160 characters)
   * @param {string}          [options.senderId] Override the instance-level sender ID
   *
   * @returns {Promise<{
   *   success: boolean,
   *   message: string,
   *   senderId: string,
   *   recipients: object[],
   *   deducted: number,
   *   remainingBalance: number
   * }>}
   *
   * @throws {SMSError}
   */
  async send({ to, message, senderId } = {}) {
    const phoneNumbers = normaliseRecipients(to);
    validateMessage(message);

    const payload = {
      phoneNumbers,
      message,
      senderId: (senderId || this.senderId).trim(),
    };

    this._log("Sending SMS", { ...payload, message: "***" });

    const response = await this._requestWithRetry(() =>
      this._http.post("/sms/send", payload)
    );

    this._log("Send response", response.data);
    return response.data;
  }

  /**
   * Send SMS messages to multiple recipients, processing them in configurable
   * batches. Unlike `send()`, a failure for one batch does NOT abort the rest.
   *
   * @param {object}   options
   * @param {string[]} options.recipients   Array of phone numbers (255XXXXXXXXX)
   * @param {string}   options.message      Message text (max 160 characters)
   * @param {string}   [options.senderId]   Override the instance-level sender ID
   * @param {number}   [options.batchSize]  Numbers per API call (default: 100)
   *
   * @returns {Promise<{
   *   totalRecipients: number,
   *   successful: object[],
   *   failed: Array<{ batch: string[], error: string, code: string }>,
   *   summary: { sent: number, failed: number }
   * }>}
   */
  async sendBulk({ recipients, message, senderId, batchSize = 100 } = {}) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new SMSError(
        "recipients must be a non-empty array",
        "INVALID_RECIPIENTS"
      );
    }

    validateMessage(message);

    const size = typeof batchSize === "number" && batchSize > 0 ? batchSize : 100;

    // Split into batches
    const batches = [];
    for (let i = 0; i < recipients.length; i += size) {
      batches.push(recipients.slice(i, i + size));
    }

    this._log(`sendBulk: ${recipients.length} recipients → ${batches.length} batch(es)`);

    const successful = [];
    const failed = [];

    // Process batches concurrently; capture errors without throwing
    await Promise.all(
      batches.map(async (batch) => {
        try {
          const result = await this.send({ to: batch, message, senderId });
          successful.push(result);
        } catch (err) {
          this._log("Batch failed", { batch, error: err.message });
          failed.push({
            batch,
            error: err.message,
            code: err.code || "UNKNOWN_ERROR",
          });
        }
      })
    );

    return {
      totalRecipients: recipients.length,
      successful,
      failed,
      summary: {
        sent: successful.reduce((acc, r) => acc + (r.deducted ?? 0), 0),
        failed: failed.reduce((acc, f) => acc + f.batch.length, 0),
      },
    };
  }

  /**
   * Retrieve the current account balance.
   *
   * @returns {Promise<{
   *   success: boolean,
   *   balance: number,
   *   currency: string,
   *   smsRate: number
   * }>}
   *
   * @throws {SMSError}
   */
  async getBalance() {
    this._log("Fetching account balance");

    const response = await this._requestWithRetry(() =>
      this._http.get("/account/balance")
    );

    this._log("Balance response", response.data);
    return response.data;
  }
}

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────

module.exports = SMSBulkTZ;
module.exports.SMSBulkTZ = SMSBulkTZ;
module.exports.SMSError = SMSError;
