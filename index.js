"use strict";

const fetch = require("node-fetch");

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const DEFAULT_BASE_URL       = "https://api.smstapsa.site/v1";
const DEFAULT_SENDER_ID      = "TAPSA";
const DEFAULT_TIMEOUT_MS     = 15_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_MESSAGE_LENGTH     = 160;
const PHONE_REGEX            = /^255\d{9}$/; // Tanzania: 255XXXXXXXXX

// ─────────────────────────────────────────────
// Custom Error Class
// ─────────────────────────────────────────────

class SMSError extends Error {
  constructor(message, code, status = null, raw = null) {
    super(message);
    this.name   = "SMSError";
    this.code   = code;
    this.status = status;
    this.raw    = raw;
  }
}

// ─────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validatePhone(phone) {
  if (typeof phone !== "string") {
    return { valid: false, reason: `Expected string, got ${typeof phone}` };
  }
  const t = phone.trim();
  if (!PHONE_REGEX.test(t)) {
    return {
      valid: false,
      reason: `"${t}" must match format 255XXXXXXXXX (e.g. 255712345678)`,
    };
  }
  return { valid: true };
}

function normaliseRecipients(value) {
  if (!value) {
    throw new SMSError(
      "Recipient(s) required — pass a string or array to `to`",
      "INVALID_RECIPIENTS"
    );
  }

  const list = (Array.isArray(value) ? value : [value]).map((p) =>
    typeof p === "string" ? p.trim() : p
  );

  if (list.length === 0) {
    throw new SMSError("At least one recipient is required", "INVALID_RECIPIENTS");
  }

  const invalid = list
    .map((p) => ({ p, ...validatePhone(p) }))
    .filter((r) => !r.valid);

  if (invalid.length > 0) {
    const detail = invalid.map((r) => `  • ${r.reason}`).join("\n");
    throw new SMSError(`Invalid phone number(s):\n${detail}`, "INVALID_PHONE_NUMBER");
  }

  return list;
}

function validateMessage(message) {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new SMSError("Message must be a non-empty string", "INVALID_MESSAGE");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new SMSError(
      `Message exceeds ${MAX_MESSAGE_LENGTH} characters (got ${message.length})`,
      "MESSAGE_TOO_LONG"
    );
  }
}

function makeTimeoutSignal(ms) {
  if (typeof AbortController === "undefined") {
    return { signal: null, clear: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear:  () => clearTimeout(timer),
  };
}

/**
 * Parse an API response into a plain object.
 * Handles non-JSON and malformed JSON responses gracefully.
 */
async function parseResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text().catch(() => "");

  if (!contentType.includes("application/json")) {
    // Non-JSON body (HTML error page, plain text, etc.)
    throw new SMSError(
      `API returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`,
      res.ok ? "UNEXPECTED_RESPONSE" : httpCodeToSMSCode(res.status),
      res.status,
      text
    );
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    // Malformed JSON
    throw new SMSError(
      `Failed to parse JSON response (HTTP ${res.status})`,
      "INVALID_JSON_RESPONSE",
      res.status,
      text
    );
  }
}

function httpCodeToSMSCode(status) {
  return (
    {
      400: "BAD_REQUEST",
      401: "UNAUTHORIZED",
      402: "INSUFFICIENT_BALANCE",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      429: "RATE_LIMITED",
      500: "SERVER_ERROR",
      502: "SERVER_ERROR",
      503: "SERVER_UNAVAILABLE",
    }[status] || "API_ERROR"
  );
}

// ─────────────────────────────────────────────
// Main Class
// ─────────────────────────────────────────────

class SMSBulkTZ {
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
      throw new SMSError(
        "A valid API key is required. Get one at https://smstapsa.site/api-keys.html",
        "MISSING_API_KEY"
      );
    }

    this.apiKey        = apiKey.trim();
    this.senderId      = (senderId || DEFAULT_SENDER_ID).trim();
    this.baseURL       = (baseURL  || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout       = typeof timeout       === "number" && timeout       > 0  ? timeout       : DEFAULT_TIMEOUT_MS;
    this.retryAttempts = typeof retryAttempts === "number" && retryAttempts >= 0 ? retryAttempts : DEFAULT_RETRY_ATTEMPTS;
    this.retryDelay    = typeof retryDelay    === "number" && retryDelay    >= 0 ? retryDelay    : DEFAULT_RETRY_DELAY_MS;
    this.debug         = Boolean(debug);
  }

  _log(...args) {
    if (this.debug) console.debug("[sms-bulk-tz]", ...args);
  }

  /**
   * Make a fetch request with timeout + retry + exponential back-off.
   * Retries on network errors, 5xx, and 429 (rate-limited).
   * Never retries on other 4xx.
   */
  async _fetch(path, options = {}) {
    const url   = `${this.baseURL}${path}`;
    let lastErr;
    let delay = this.retryDelay;

    for (let attempt = 1; attempt <= this.retryAttempts + 1; attempt++) {
      const { signal, clear } = makeTimeoutSignal(this.timeout);

      try {
        this._log(`Attempt ${attempt} — ${options.method || "GET"} ${url}`);

        const res = await fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.apiKey,
            ...(options.headers || {}),
          },
          ...(signal ? { signal } : {}),
        });

        clear();

        // Handle rate limiting (429) specially: server may suggest Retry-After
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          const serverBody = await res.text().catch(() => "");
          const suggestedDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
          this._log(`Rate limited (HTTP 429). Server suggests retry after ${suggestedDelay}ms.`);
          lastErr = new SMSError(
            `Rate limited by server (HTTP 429)`,
            "RATE_LIMITED",
            429,
            serverBody
          );

          const isLastAttempt = attempt > this.retryAttempts;
          if (isLastAttempt) break;

          await sleep(suggestedDelay);
          delay = Math.min(delay * 2, 10_000);
          continue; // retry loop
        }

        // 4xx (other than 429) — don't retry, surface immediately
        if (res.status >= 400 && res.status < 500) {
          const body = await parseResponse(res).catch((e) => ({ error: e.message }));
          const msg  = body?.error || body?.message || `HTTP ${res.status}`;
          throw new SMSError(msg, httpCodeToSMSCode(res.status), res.status, body);
        }

        // 5xx — allow retry below
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new SMSError(
            `Server error HTTP ${res.status}`,
            "SERVER_ERROR",
            res.status,
            text
          );
        }

        return res;
      } catch (err) {
        clear();
        lastErr = err;

        // Never retry SMSErrors from 4xx
        if (err instanceof SMSError && err.status && err.status < 500 && err.status !== 429) break;

        // Timeout — include URL for context
        if (err.name === "AbortError") {
          lastErr = new SMSError(
            `Request to ${url} timed out after ${this.timeout}ms`,
            "REQUEST_TIMEOUT"
          );
          break; // timeout is not a transient retry-able error
        }

        const isLastAttempt = attempt > this.retryAttempts;
        if (isLastAttempt) break;

        this._log(`Retrying in ${delay}ms… (${err.message})`);
        await sleep(delay);
        delay = Math.min(delay * 2, 10_000);
      }
    }

    // Wrap raw fetch/network errors into SMSError
    if (!(lastErr instanceof SMSError)) {
      const code =
        lastErr?.code === "ENOTFOUND"    ? "NETWORK_ERROR" :
        lastErr?.code === "ECONNREFUSED" ? "NETWORK_ERROR" :
        lastErr?.code === "EAI_AGAIN"    ? "NETWORK_ERROR" :
        "NETWORK_ERROR";

      lastErr = new SMSError(
        `Network error: ${lastErr?.message || "unknown"} — check your internet connection.`,
        code
      );
    }

    throw lastErr;
  }

  // ─── Public API ───────────────────────────────

  async send({ to, message, senderId } = {}) {
    const phoneNumbers = normaliseRecipients(to);
    validateMessage(message);

    const payload = {
      phoneNumbers,
      message,
      senderId: (senderId || this.senderId).trim(),
    };

    // redact message content consistently
    this._log("Sending SMS →", { ...payload, message: "[REDACTED]" });

    const res  = await this._fetch("/sms/send", {
      method: "POST",
      body:   JSON.stringify(payload),
    });
    const data = await parseResponse(res);

    this._log("Response ←", data);
    return data;
  }

  /**
   * Send an SMS to a large recipient list, split into parallel batches.
   * One batch failing does NOT abort the others.
   */
  async sendBulk({ recipients, message, senderId, batchSize = 100 } = {}) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new SMSError(
        "'recipients' must be a non-empty array",
        "INVALID_RECIPIENTS"
      );
    }
    validateMessage(message);

    const size    = typeof batchSize === "number" && batchSize > 0 ? batchSize : 100;
    const batches = [];
    for (let i = 0; i < recipients.length; i += size) {
      batches.push(recipients.slice(i, i + size));
    }

    // redact recipients and message in logs
    this._log("Sending Bulk SMS →", { recipients: "[REDACTED]", message: "[REDACTED]", batches: batches.length });

    const successful = [];
    const failed     = [];

    await Promise.all(
      batches.map(async (batch) => {
        try {
          const result = await this.send({ to: batch, message, senderId });
          successful.push(result);
        } catch (err) {
          // include batch info in the error for easier debugging
          const batchInfo = Array.isArray(batch) ? batch.join(", ") : String(batch);
          const errMsg = `${err.message}${batchInfo ? ` (batch ${batchInfo})` : ""}`;
          this._log("Batch failed:", errMsg);
          failed.push({
            batch,
            error: errMsg,
            code:  err.code || "UNKNOWN_ERROR",
          });
        }
      })
    );

    return {
      totalRecipients: recipients.length,
      successful,
      failed,
      summary: {
        sent:            successful.reduce((n, r) => n + (r.deducted   ?? 0), 0),
        failed:          failed.reduce(    (n, f) => n + f.batch.length,      0),
        successfulCount: successful.length,
        failedCount:     failed.length,
      },
    };
  }

  async getBalance() {
    this._log("GET /account/balance");

    const res  = await this._fetch("/account/balance");
    const data = await parseResponse(res);

    this._log("Response ←", data);
    return data;
  }

  async diagnose() {
    const candidates = [
      this.baseURL,
      "https://api.smstapsa.site/v1",
      "https://smstapsa.site/v1",
      "https://smstapsa.site/api/v1",
    ].filter((u, i, arr) => arr.indexOf(u) === i); // dedupe

    console.log("[sms-bulk-tz] Running connectivity diagnosis…\n");

    const results = await Promise.all(
      candidates.map(async (baseURL) => {
        const url = `${baseURL}/account/balance`;
        const { signal, clear } = makeTimeoutSignal(8_000);
        try {
          const res = await fetch(url, {
            headers: { "X-API-Key": this.apiKey },
            ...(signal ? { signal } : {}),
          });
          clear();
          const reachable = res.ok || res.status === 401;
          console.log(`  ${reachable ? "✅" : "⚠️ "}  ${baseURL}  →  HTTP ${res.status}`);
          return { url: baseURL, reachable, status: res.status };
        } catch (err) {
          clear();
          const reason = err.name === "AbortError" ? "timeout" : (err.code || err.message);
          console.log(`  ❌  ${baseURL}  →  ${reason}`);
          return { url: baseURL, reachable: false, error: reason };
        }
      })
    );

    const working = results.find((r) => r.reachable);

    console.log("");
    if (working) {
      console.log(`[sms-bulk-tz] ✅ Working URL: ${working.url}`);
      if (working.url !== this.baseURL) {
        console.log(
          `  → Pass this to your constructor:\n` +
          `    new SMSBulkTZ({ baseURL: "${working.url}", ... })\n` +
          `  → Or set SMS_BASE_URL="${working.url}" in your .env`
        );
      }
    } else {
      console.log("[sms-bulk-tz] ❌ No URL responded. Check your internet connection and API key.");
    }
    console.log("");

    return {
      configured: this.baseURL,
      reachable:  Boolean(working),
      workingURL: working?.url ?? null,
      results,
    };
  }
}

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────

module.exports           = SMSBulkTZ;
module.exports.SMSBulkTZ = SMSBulkTZ;
module.exports.SMSError  = SMSError;
