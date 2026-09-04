# tapsa-sms

Official Node.js SDK for the [SMSTAPSA SMS API](https://smstapsa.site/). Send SMS messages and check account balances from Node.js applications with a small, typed client.

## Installation

```bash
npm install tapsa-sms
```

Node.js 18 or newer is required.

## Authentication

Create an API key in your SMSTAPSA account and provide it through an environment variable. Never commit the key to source control.

```bash
TAPSA_API_KEY=your_api_key
```

## Quick Start

```ts
import { TapsaSMS } from 'tapsa-sms';

const tapsa = new TapsaSMS({
  apiKey: process.env.TAPSA_API_KEY!
});

const result = await tapsa.sendSMS({
  phoneNumbers: ['255712345678'],
  message: 'Hello from SMSTAPSA',
  senderId: 'TAPSA'
});

console.log(result);
```

## Send SMS

Send to one recipient:

```ts
await tapsa.sendSMS({
  phoneNumbers: ['255712345678'],
  message: 'Your appointment is confirmed.',
  senderId: 'TAPSA'
});
```

Send to multiple recipients:

```ts
await tapsa.sendSMS({
  phoneNumbers: ['255712345678', '255713456789', '255714567890'],
  message: 'Hello everyone',
  senderId: 'TAPSA'
});
```

Phone numbers must be provided as a non-empty array of non-empty strings. The SDK does not impose a country-specific format restriction.

## Check Balance

```ts
const balance = await tapsa.getBalance();
console.log(balance.data.balance, balance.data.currency);
```

## Error Handling

API and validation failures throw `TapsaAPIError`. It exposes `message`, `status`, `code`, `response`, and `data` so the original API details remain available.

```ts
import { TapsaAPIError } from 'tapsa-sms';

try {
  await tapsa.sendSMS({ phoneNumbers: ['255712345678'], message: 'Hello' });
} catch (error) {
  if (error instanceof TapsaAPIError) {
    console.error(error.status, error.code, error.message, error.data);
  }
}
```

HTTP statuses 400, 401, 402, 403, 429, and 500 are preserved. Network failures, timeouts, and malformed JSON responses receive explicit error codes.

## Configuration

```ts
const tapsa = new TapsaSMS({
  apiKey: process.env.TAPSA_API_KEY!,
  baseUrl: 'https://api.smstapsa.site',
  timeout: 30_000
});
```

`baseUrl` defaults to `https://api.smstapsa.site` and is useful for test servers. `timeout` defaults to 30 seconds.

## API Reference

- `new TapsaSMS({ apiKey, baseUrl?, timeout? })`
- `sendSMS({ phoneNumbers, message, senderId? })`, which calls `POST /v1/sms/send`
- `getBalance()`, which calls `GET /v1/account/balance`

All request and response interfaces are exported for TypeScript users, including `TapsaSMSOptions`, `SendSMSOptions`, `SendSMSResponse`, and `BalanceResponse`.

## Examples

Runnable source examples are in [`examples/send-sms.ts`](examples/send-sms.ts) and [`examples/balance.ts`](examples/balance.ts).

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The published package contains only `dist`, this README, the license, and the changelog.

## Documentation

Read the official [SMSTAPSA documentation](https://smstapsa.site/).

## License

MIT
