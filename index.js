const axios = require("axios");

class SMSBulkTZ {
  constructor({ apiKey, sender, baseURL }) {
    if (!apiKey) {
      throw new Error("API key is required");
    }

    this.apiKey = apiKey;
    this.sender = sender || "TAPSA";
    this.baseURL = baseURL || "https://smstapsa.site/api";
  }

  // Send single SMS
  async send({ to, message }) {
    if (!to) throw new Error("Recipient number is required");
    if (!message) throw new Error("Message is required");

    try {
      const res = await axios.post(`${this.baseURL}/send`, {
        api_key: this.apiKey,
        from: this.sender,
        to: to,
        text: message
      });

      return res.data;
    } catch (err) {
      throw new Error(
        err.response?.data?.message || "Failed to send SMS"
      );
    }
  }

  // Send bulk SMS
  async sendBulk({ recipients, message }) {
    if (!Array.isArray(recipients)) {
      throw new Error("Recipients must be an array");
    }

    if (!message) {
      throw new Error("Message is required");
    }

    try {
      const results = await Promise.all(
        recipients.map((number) =>
          this.send({ to: number, message })
        )
      );

      return results;
    } catch (err) {
      throw new Error("Bulk SMS failed");
    }
  }

  // Optional: Check balance
  async getBalance() {
    try {
      const res = await axios.get(`${this.baseURL}/balance`, {
        params: {
          api_key: this.apiKey
        }
      });

      return res.data;
    } catch (err) {
      throw new Error("Failed to fetch balance");
    }
  }
}

module.exports = SMSBulkTZ;
