# sms-bulk-tz

> A production-ready Node.js client for the [TAPSA Bulk SMS API](https://smstapsa.site/api-docs) — send single or bulk SMS messages to Tanzanian phone numbers with built-in retry, structured error handling, and full input validation.

[![npm version](https://img.shields.io/npm/v/sms-bulk-tz.svg)](https://www.npmjs.com/package/sms-bulk-tz)
[![license](https://img.shields.io/npm/l/sms-bulk-tz.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/sms-bulk-tz.svg)](https://nodejs.org)

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
  - [send()](#send)
  - [sendBulk()](#sendbulk)
  - [getBalance()](#getbalance)
- [Error Handling](#error-handling)
- [Error Codes](#error-codes)
- [Debug Mode](#debug-mode)
- [Phone Number Format](#phone-number-format)
- [License](#license)

---

## Features

- ✅ Send SMS to a **single recipient or multiple** in one API call
- 📦 **Batch processing** for very large recipient lists with configurable batch size
- 🔁 **Automatic retry** with exponential back-off on transient/server errors
- ⏱️ **Timeout handling** — every request respects a configurable deadline
- 🛡️ **Input validation** — phone format (`255XXXXXXXXX`), message length (max 160 chars), and required fields — all checked before hitting the network
- 🧱 **Structured errors** — every thrown error carries a machine-readable `.code`, HTTP `.status`, and raw `.raw` response body
- 🔇 Zero noise in production, opt-in **debug logging** for development
- 🪶 Single runtime dependency (`axios`)

---

## Requirements

- Node.js **≥ 14.0.0**
- A [TAPSA Bulk SMS](https://smstapsa.site) account and API key

---

## Installation

```bash
npm install sms-bulk-tz
```

---

## Quick Start

```js
const SMSBulkTZ = require("sms-bulk-tz");

const sms = new SMSBulkTZ({
  apiKey: "your_api_key_here",
  senderId: "MYAPP",       // optional, defaults to "TAPSA"
});

// Send to a single number
const result = await sms.send({
  to: "255712345678",
  message: "Hello from MYAPP!",
});

console.log(result);
// {
//   success: true,
//   message: "Messages processed",
//   senderId: "MYAPP",
//   recipients: [...],
//   deducted: 1,
//   remainingBalance: 149
// }
```

---

## Configuration

Pass options to the constructor to customise the client's behaviour.

```js
const sms = new SMSBulkTZ({
  apiKey: "your_api_key_here",   // required
  senderId: "MYAPP",             // default: "TAPSA"
  timeout: 15000,                // ms — default: 10 000
  retryAttempts: 3,              // default: 3  (0 = no retries)
  retryDelay: 500,               // ms initial delay, doubles each attempt — default: 500
  debug: false,                  // default: false
  baseURL: "https://api.smstapsa.site/v1", // default — override only if needed
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | — | **Required.** Your TAPSA API key |
| `senderId` | `string` | `"TAPSA"` | Sender name shown to recipients |
| `timeout` | `number` | `10000` | Request timeout in milliseconds |
| `retryAttempts` | `number` | `3` | Max retries on network/server errors (4xx errors are never retried) |
| `retryDelay` | `number` | `500` | Initial delay in ms between retries; doubles each attempt |
| `debug` | `boolean` | `false` | Log verbose debug output to `console.debug` |
| `baseURL` | `string` | TAPSA API URL | Override the base API URL |

---

## API Reference

### `send()`

Send a message to one or more recipients in a **single API call**.

```js
const result = await sms.send({
  to: "255712345678",               // string or string[]
  message: "Your OTP is 482910",
  senderId: "MYAPP",                // optional — overrides instance senderId
});
```

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `to` | `string \| string[]` | ✅ | Recipient number(s) in `255XXXXXXXXX` format |
| `message` | `string` | ✅ | Message text — max 160 characters |
| `senderId` | `string` | ❌ | Overrides the instance-level `senderId` for this call only |

**Returns** `Promise<object>`

```json
{
  "success": true,
  "message": "Messages processed",
  "senderId": "MYAPP",
  "recipients": [...],
  "deducted": 1,
  "remainingBalance": 148
}
```

---

### `sendBulk()`

Send a message to a large list of recipients. Internally splits the list into parallel batches. **A failure in one batch does not abort the others** — results from all batches are always returned.

```js
const result = await sms.sendBulk({
  recipients: [
    "255712345678",
    "255765432100",
    "255789000111",
    // ... hundreds more
  ],
  message: "Our sale ends tonight — shop now!",
  batchSize: 100,   // optional — numbers per API call, default: 100
  senderId: "SHOP", // optional
});

console.log(result.summary);
// { sent: 3, failed: 0 }
```

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `recipients` | `string[]` | ✅ | Array of phone numbers (`255XXXXXXXXX` format) |
| `message` | `string` | ✅ | Message text — max 160 characters |
| `batchSize` | `number` | ❌ | Recipients per API call — default `100` |
| `senderId` | `string` | ❌ | Overrides the instance-level `senderId` for this call only |

**Returns** `Promise<object>`

```json
{
  "totalRecipients": 3,
  "successful": [ /* one entry per successful batch */ ],
  "failed": [
    {
      "batch": ["255799000000"],
      "error": "Insufficient balance",
      "code": "INSUFFICIENT_BALANCE"
    }
  ],
  "summary": {
    "sent": 2,
    "failed": 1
  }
}
```

---

### `getBalance()`

Retrieve the current account balance.

```js
const balance = await sms.getBalance();

console.log(balance);
// {
//   success: true,
//   balance: 148,
//   currency: "TZS",
//   smsRate: 30
// }
```

---

## Error Handling

All methods throw an `SMSError` on failure. Import it for `instanceof` checks.

```js
const SMSBulkTZ = require("sms-bulk-tz");
const { SMSError } = require("sms-bulk-tz");

try {
  await sms.send({ to: "255712345678", message: "Hello!" });
} catch (err) {
  if (err instanceof SMSError) {
    console.error(err.message);  // human-readable description
    console.error(err.code);     // machine-readable code (see table below)
    console.error(err.status);   // HTTP status code, or null for network errors
    console.error(err.raw);      // raw API response body, or null
  }
}
```

**Branching on error codes:**

```js
} catch (err) {
  if (!(err instanceof SMSError)) throw err; // re-throw unexpected errors

  switch (err.code) {
    case "INSUFFICIENT_BALANCE":
      await notifyAdminToTopUp();
      break;
    case "UNAUTHORIZED":
      console.error("Check your API key");
      break;
    case "INVALID_PHONE_NUMBER":
      console.error("Bad input:", err.message);
      break;
    case "REQUEST_TIMEOUT":
      console.error("Request timed out — retry later");
      break;
    default:
      throw err;
  }
}
```

---

## Error Codes

| Code | Source | Description |
|---|---|---|
| `MISSING_API_KEY` | Client | No API key provided to the constructor |
| `INVALID_RECIPIENTS` | Client | `to` / `recipients` is missing or empty |
| `INVALID_PHONE_NUMBER` | Client | One or more numbers fail `255XXXXXXXXX` validation |
| `INVALID_MESSAGE` | Client | Message is missing or empty |
| `MESSAGE_TOO_LONG` | Client | Message exceeds 160 characters |
| `REQUEST_TIMEOUT` | Network | Request exceeded the configured `timeout` |
| `NETWORK_ERROR` | Network | No response received (DNS failure, connection refused, etc.) |
| `BAD_REQUEST` | API (400) | Invalid parameters sent to the API |
| `UNAUTHORIZED` | API (401) | API key is invalid or missing |
| `INSUFFICIENT_BALANCE` | API (402) | Account does not have enough credit |
| `SERVER_ERROR` | API (500) | Unexpected error on the TAPSA server |
| `API_ERROR` | API (other) | Any other non-2xx API response |

---

## Debug Mode

Enable `debug: true` to log all requests, responses, retry attempts, and batch results to `console.debug`. Useful during development — disable in production.

```js
const sms = new SMSBulkTZ({
  apiKey: "your_api_key_here",
  debug: true,
});
```

Example output:

```
[sms-bulk-tz] Attempt 1…
[sms-bulk-tz] Sending SMS { phoneNumbers: ['255712345678'], message: '***', senderId: 'TAPSA' }
[sms-bulk-tz] Send response { success: true, deducted: 1, remainingBalance: 147, ... }
```

> Messages are redacted in debug output — the actual `message` text is never logged.

---

## Phone Number Format

All phone numbers must be in **international format without a `+`**:

```
255 7XX XXX XXX
└─┘ └───────────┘
 TZ   9 digits
```

| ✅ Valid | ❌ Invalid |
|---|---|
| `255712345678` | `0712345678` (missing country code) |
| `255765432100` | `+255712345678` (leading `+` not allowed) |
| `255789000111` | `712345678` (too short) |

---

## License

[MIT](./LICENSE)

---

> Built for the [TAPSA Bulk SMS API](https://smstapsa.site). Not officially affiliated with Lazack Organisation.
> 
