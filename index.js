"use strict";

const axios = require("axios");

// ─────────────────────────────────────────────
// DEFAULT CONFIG (SAFE FOR PRODUCTION)
// ─────────────────────────────────────────────

const DEFAULT_CONFIG = {
  baseURL: "https://api.smstapsa.site/v1", // change if docs differ
  senderId: "TAPSA",
  timeout: 10000,
  retryAttempts: 3,
  retryDelay: 500,
  debug: false,

  // ⚠️ IMPORTANT: must match API docs exactly
  endpoints: {
    send: "/sms/send",
    bulk: "/sms/send-bulk",
    balance: "/sms/balance",
  },
};

// ─────────────────────────────────────────────
// ERROR CLASS
// ─────────────────────────────────────────────

class SMSError extends Error {
  constructor(message, code, status = null, raw = null) {
    super(message);
    this.name = "SMSError";
    this.code = code;
    this.status = status;
    this.raw = raw;
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHONE_REGEX = /^255\d{9}$/;

function validatePhones(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new SMSError("Recipients required", "INVALID_RECIPIENTS");
  }

  const invalid = list.filter((p) => typeof p !== "string" || !PHONE_REGEX.test(p));

  if (invalid.length) {
    throw new SMSError(
      `Invalid phones: ${invalid.join(", ")}`,
      "INVALID_PHONE_NUMBER"
    );
  }

  return list;
}

function validateMessage(msg) {
  if (!msg || typeof msg !== "string") {
    throw new SMSError("Message required", "INVALID_MESSAGE");
  }

  if (msg.length > 160) {
    throw new SMSError("Message too long (max 160)", "MESSAGE_TOO_LONG");
  }
}

// ─────────────────────────────────────────────
// SDK CLASS
// ─────────────────────────────────────────────

class SMSBulkTZ {
  constructor(options = {}) {
    if (!options.apiKey) {
      throw new SMSError("API key required", "MISSING_API_KEY");
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...options,
      endpoints: {
        ...DEFAULT_CONFIG.endpoints,
        ...(options.endpoints || {}),
      },
    };

    this.http = axios.create({
      baseURL: this.config.baseURL.replace(/\/$/, ""),
      timeout: this.config.timeout,
      headers: {
        "Content-Type": "application/json",

        // 🔥 dual auth support (fixes most API issues)
        "X-API-Key": options.apiKey,
        Authorization: `Bearer ${options.apiKey}`,
      },
    });
  }

  // ─────────────────────────────────────────────
  // LOGGER
  // ─────────────────────────────────────────────

  log(...args) {
    if (this.config.debug) console.log("[SMS-SDK]", ...args);
  }

  // ─────────────────────────────────────────────
  // RETRY ENGINE
  // ─────────────────────────────────────────────

  async request(fn) {
    let delay = this.config.retryDelay;
    let lastError;

    for (let i = 0; i <= this.config.retryAttempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        const status = err.response?.status;
        const isClientError = status >= 400 && status < 500;

        if (isClientError) break;

        this.log(`Retry ${i + 1} failed, retrying in ${delay}ms`);
        await sleep(delay);
        delay *= 2;
      }
    }

    throw this.normalizeError(lastError);
  }

  // ─────────────────────────────────────────────
  // ERROR NORMALIZER
  // ─────────────────────────────────────────────

  normalizeError(err) {
    if (err instanceof SMSError) return err;

    if (!err.response) {
      return new SMSError("Network error", "NETWORK_ERROR");
    }

    const { status, data } = err.response;

    return new SMSError(
      data?.message || "API error",
      data?.code || "API_ERROR",
      status,
      data
    );
  }

  // ─────────────────────────────────────────────
  // SEND SMS
  // ─────────────────────────────────────────────

  async send({ to, message, senderId } = {}) {
    const phones = validatePhones(Array.isArray(to) ? to : [to]);
    validateMessage(message);

    const payload = {
      phoneNumbers: phones,
      message,
      senderId: senderId || this.config.senderId,
    };

    this.log("SEND:", payload);

    const res = await this.request(() =>
      this.http.post(this.config.endpoints.send, payload)
    );

    return res.data;
  }

  // ─────────────────────────────────────────────
  // BULK SMS
  // ─────────────────────────────────────────────

  async sendBulk({ recipients, message, senderId } = {}) {
    validatePhones(recipients);
    validateMessage(message);

    const res = await this.request(() =>
      this.http.post(this.config.endpoints.bulk, {
        recipients,
        message,
        senderId: senderId || this.config.senderId,
      })
    );

    return res.data;
  }

  // ─────────────────────────────────────────────
  // BALANCE
  // ─────────────────────────────────────────────

  async getBalance() {
    const res = await this.request(() =>
      this.http.get(this.config.endpoints.balance)
    );

    return res.data;
  }
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = SMSBulkTZ;
module.exports.SMSError = SMSError;