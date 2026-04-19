"use strict";

const axios = require("axios");

const DEFAULT_CONFIG = {
  baseURL: "https://api.smstapsa.site/v1",
  senderId: "TAPSA", // Global default
  timeout: 10000,
  endpoints: {
    send: "/sms/send",
    balance: "/account/balance",
  },
};

class SMSError extends Error {
  constructor(message, status = null, raw = null) {
    super(message);
    this.name = "SMSError";
    this.status = status;
    this.raw = raw;
  }
}

class SMSBulkTZ {
  constructor(options = {}) {
    if (!options.apiKey) {
      throw new SMSError("API key is required");
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...options,
    };

    this.http = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": options.apiKey,
      },
    });
  }

  async _request(fn) {
    try {
      const response = await fn();
      if (response.data && response.data.success === false) {
        throw new SMSError(response.data.error || "API Error", null, response.data);
      }
      return response.data;
    } catch (err) {
      if (err instanceof SMSError) throw err;
      const status = err.response?.status;
      const data = err.response?.data;
      throw new SMSError(data?.error || err.message, status, data);
    }
  }

  /**
   * Send SMS
   * @param {Object} params
   * @param {string|string[]} params.to - Single phone or array of phones
   * @param {string} params.message - The SMS content
   * @param {string} [params.senderId] - Optional custom Sender ID (must be approved on your account)
   */
  async send({ to, message, senderId } = {}) {
    // 1. Ensure phoneNumbers is always an array
    const phoneNumbers = Array.isArray(to) ? to : [to];

    // 2. Logical priority: 
    //    Method Parameter > Constructor Option > Default "TAPSA"
    const finalSenderId = senderId || this.config.senderId;

    const payload = {
      phoneNumbers,
      message,
      senderId: finalSenderId,
    };

    return this._request(() => 
      this.http.post(this.config.endpoints.send, payload)
    );
  }

  async getBalance() {
    return this._request(() => 
      this.http.get(this.config.endpoints.balance)
    );
  }
}

module.exports = SMSBulkTZ;